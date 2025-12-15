import type {
  SchemaResponse,
  ColumnInfo,
  TableInfo,
  Constraint,
  ColumnValueGenerationStrategy,
  SchemaRequest,
  DetailLevel,
  TableName,
  ColumnTypeArray,
  ObjectTypeDefinition,
  ColumnTypeObject,
  Field,
  ColumnType,
} from "@hasura/dc-api-types";
import type { ScalarTypeKey } from "./capabilities";
import type { Config } from "./config";
import { type Connection, type SqlLogger, withConnection } from "./db";
import { unreachable } from "./util";

type TableInfoInternal = {
  table_schema: string;
  table_name: string;
  table_type: string;
  is_insertable_into: boolean;
  columns: Array<{
    column_name: string;
    data_type: string;
    is_nullable: boolean;
    is_generated: "NEVER";
  }>;
};

type Datatype = {
  affinity: string; // Sqlite affinity, lowercased
  variant: string; // Declared type, lowercased
};

// Note: Using ScalarTypeKey here instead of ScalarType to show that we have only used
//       the capability documented types, and that ScalarTypeKey is a subset of ScalarType
function determineScalarType(datatype: string): ScalarTypeKey {
  switch (datatype) {
    case "character varying":
      return "string";
    case "integer":
    case "double precision":
      return "number";
    case "boolean":
      return "bool";
    default:
      throw new Error(`Unsupported datatype ${datatype} encountered.`);
  }
}

function determineArrayType(
  name: string,
  datatype: string,
): [ColumnTypeArray, ObjectTypeDefinition[]] {
  // TODO: test
  const dataType = datatype.slice(0, -2);
  const colType = determineColumnType(dataType);
  switch (colType) {
    case "scalar":
      return [
        {
          element_type: determineScalarType(dataType),
          nullable: true,
          type: "array",
        },
        [],
      ];
    case "array":
      const [subType, objectDefs] = determineArrayType(name, dataType);
      return [
        {
          element_type: subType,
          nullable: true,
          type: "array",
        },
        objectDefs,
      ];
    case "object":
      const [objDefs, colType] = determineObjectType(name, dataType);
      return [
        {
          element_type: colType,
          nullable: true,
          type: "array",
        },
        objDefs,
      ];
  }
}

function extractObjectTypes(
  structure: any,
  nest: string = "",
): ObjectTypeDefinition[] {
  const fields: ColumnInfo[] = [];
  const types: ObjectTypeDefinition[] = [];
  Object.entries(structure).forEach(([key, value]) => {
    if (typeof value === "object" && !Array.isArray(value)) {
      const [recurred = null, ...rest] = extractObjectTypes(
        value,
        `${nest}_${key}`,
      );
      if (!recurred) {
        throw new Error("Didn't get any objects from recur");
      }
      fields.push({
        name: key,
        type: { type: "object", name: recurred.name },
        nullable: true,
      });
      types.push(recurred, ...rest);
    } else if (typeof value === "string") {
      const scalarType = determineScalarType(value);
      fields.push({
        name: key,
        type: scalarType,
        nullable: true,
      });
    } else {
      throw new Error(`Unsupported structure value ${value} encountered.`);
    }
  });
  return [{ name: nest, columns: fields }, ...types];
}

function determineObjectType(
  name: string,
  datatype: string,
): [ObjectTypeDefinition[], ColumnTypeObject] {
  // TODO: test
  // TODO: recursive structs

  // Handle simple arrays of scalars first by moving square bracket to front
  const prefaceSimpleSquares = datatype.replaceAll(/(\w+)\[/g, "[$1");

  // Handle 2D arrays by moving second square bracket to front
  const prefaceArraySquares = prefaceSimpleSquares.replaceAll(
    /(\w+)\]\[\]/g,
    "[$1]]",
  );

  const openBracketIndices = [...prefaceArraySquares.matchAll(/\[/g)]
    .map((m) => m.index)
    .filter(
      (i): i is number =>
        i !== null &&
        i !== undefined &&
        prefaceArraySquares.charAt(i - 1) == ">",
    );
  let movedOpenBrackets = prefaceArraySquares;
  for (const index of openBracketIndices) {
    let level = 0;
    for (let i = index - 1; i >= 0; i--) {
      const isOpening = movedOpenBrackets.charAt(i) == "<";
      const isClosing = movedOpenBrackets.charAt(i) == ">";
      if (level == 1 && isOpening) {
        // level should be 1 because we are closing the level that is concerning us
        // Move '[' to just before 'struct<'
        const before = movedOpenBrackets.slice(0, i - "struct".length);
        const inBetween = movedOpenBrackets.slice(i - "struct".length, index);
        const after = movedOpenBrackets.slice(index + 1);
        movedOpenBrackets = `${before}[${inBetween}${after}`;
        break;
      } else if (isClosing) {
        level++;
      } else if (isOpening) {
        level--;
      }
    }
  }

  const openStructs = movedOpenBrackets.replaceAll("struct<", "{");
  const closeStructs = openStructs.replaceAll(">", "}");
  const addColonsAndQuotekeys = closeStructs.replaceAll(
    /((?:({)(\w+))|(?:(,) (\w+))) /g,
    `$2$4 "$3$5": `,
  );
  const quoteFields = addColonsAndQuotekeys.replaceAll(
    /: ([\w ]+)([},])/g,
    `: "$1"$2`,
  );

  const structure = JSON.parse(quoteFields);
  const objectTypes = extractObjectTypes(structure, `${name}`);
  const [objDef = undefined, ...rest] = objectTypes;
  if (!objDef) {
    throw new Error("Didn't get any object definitions");
  }
  return [
    [objDef, ...rest],
    {
      type: "object",
      name: objDef.name,
    },
  ];
}

function determineColumnType(datatype: string): "array" | "object" | "scalar" {
  if (datatype.endsWith("[]")) {
    return "array";
  } else if (datatype.startsWith("struct<")) {
    return "object";
  } else {
    return "scalar";
  }
}

function getColumns(
  table: TableInfoInternal,
): [ColumnInfo[], ObjectTypeDefinition[]] {
  const pairs = table.columns.map(
    (column): [ColumnInfo, ObjectTypeDefinition[] | null] => {
      const columnType = determineColumnType(column.data_type);
      switch (columnType) {
        case "scalar":
          return [
            {
              name: column.column_name,
              type: determineScalarType(column.data_type),
              nullable: column.is_nullable,
              insertable: column.is_generated === "NEVER",
              updatable: column.is_generated === "NEVER",
              ...(column.is_generated !== "NEVER"
                ? { value_generated: { type: "auto_increment" } } // TODO: More generation strategies
                : {}),
            },
            null,
          ];
        case "array":
          const [elType, objDefs] = determineArrayType(
            `${table.table_name}_${column.column_name}_array`,
            column.data_type,
          );
          return [
            {
              name: column.column_name,
              type: elType,
              nullable: column.is_nullable,
              insertable: column.is_generated === "NEVER",
              updatable: column.is_generated === "NEVER",
              ...(column.is_generated !== "NEVER"
                ? { value_generated: { type: "auto_increment" } } // TODO: More generation strategies
                : {}),
            },
            objDefs,
          ];
        case "object":
          const [objDef, colType] = determineObjectType(
            `${table.table_name}_${column.column_name}_obj`,
            column.data_type,
          );
          return [
            {
              name: column.column_name,
              type: colType,
              nullable: column.is_nullable,
              insertable: column.is_generated === "NEVER",
              updatable: column.is_generated === "NEVER",
              ...(column.is_generated !== "NEVER"
                ? { value_generated: { type: "auto_increment" } } // TODO: More generation strategies
                : {}),
            },
            objDef,
          ];
      }
    },
  );
  const columns: ColumnInfo[] = pairs.map(([column]) => column);
  const objectTypes = pairs
    .map(([, objDef]) => objDef)
    .filter((objDef): objDef is ObjectTypeDefinition[] => objDef !== null)
    .flat();
  return [columns, objectTypes];
}

const formatTableInfo =
  (db: Connection, config: Config, detailLevel: DetailLevel) =>
  async (
    info: TableInfoInternal,
  ): Promise<[TableInfo, ObjectTypeDefinition[]]> => {
    switch (detailLevel) {
      case "everything":
        return await formatEverythingTableInfo(db, config)(info);
      case "basic_info":
        return [await formatBasicTableInfo(config)(info), []];
      default:
        return unreachable(detailLevel);
    }
  };

const formatBasicTableInfo =
  (config: Config) =>
  async (info: TableInfoInternal): Promise<TableInfo> => {
    const tableName = [info.table_schema, info.table_name];
    return {
      name: tableName,
      type: "table",
    };
  };

const formatEverythingTableInfo =
  (db: Connection, config: Config) =>
  async (
    info: TableInfoInternal,
  ): Promise<[TableInfo, ObjectTypeDefinition[]]> => {
    const basicTableInfo = await formatBasicTableInfo(config)(info);
    const description = await db.query(`DESCRIBE ${info.table_name};`); // Have to get primary key from DESCRIBE, not in information_schema
    const primaryKeys = getPrimaryKeyNames(description);
    const primaryKey =
      primaryKeys.length > 0 ? { primary_key: primaryKeys } : {};

    const [columns, objectTypes] = getColumns(info);

    if (primaryKeys.length == 1 && primaryKeys[0] == "_row_id") {
      columns.push({
        name: "_row_id",
        type: "number",
        nullable: false,
        insertable: false,
        updatable: false,
        value_generated: { type: "auto_increment" },
      });
    }

    return [
      {
        ...basicTableInfo,
        ...primaryKey,
        description: "a table",
        columns,
        insertable: info.is_insertable_into,
        updatable: info.is_insertable_into,
        deletable: info.is_insertable_into,
      },
      objectTypes,
    ];
  };

const includeTable =
  (config: Config, only_tables?: TableName[]) =>
  (table: TableInfoInternal): boolean => {
    const filterForOnlyTheseTables = only_tables
      // Just keep the actual table name
      ?.map((n) => n[n.length - 1]);

    if (only_tables) {
      return (filterForOnlyTheseTables ?? []).includes(table.table_name);
    } else {
      return true;
    }
  };

/**
 * Pulls columns from the output of sqlite-parser.
 * Note that this doesn't check if duplicates are present and will emit them as many times as they are present.
 * This is done as an easy way to preserve order.
 *
 * @param ddl - The output of sqlite-parser
 * @returns - List of columns as present in the output of sqlite-parser.
 */
function getColumnsDdl(ddl: any): any[] {
  if (ddl.type != "statement" || ddl.variant != "list") {
    throw new Error(
      "Encountered a non-statement or non-list when parsing DDL for table.",
    );
  }
  return ddl.statement.flatMap((t: any) => {
    if (t.type != "statement" || t.variant != "create" || t.format != "table") {
      return [];
    }
    return t.definition.flatMap((c: any) => {
      if (c.type != "definition" || c.variant != "column") {
        return [];
      }
      return [c];
    });
  });
}

/**
 * Example:
 *
 * foreign_keys: {
 *   "ArtistId->Artist.ArtistId": {
 *     column_mapping: {
 *       "ArtistId": "ArtistId"
 *     },
 *     foreign_table: "Artist",
 *   }
 * }
 *
 * NOTE: We currently don't log if the structure of the DDL is unexpected, which could be the case for composite FKs, etc.
 * NOTE: There could be multiple paths between tables.
 * NOTE: Composite keys are not currently supported.
 *
 * @param ddl
 * @returns [name, FK constraint definition][]
 */
function ddlFKs(
  config: Config,
  tableName: Array<string>,
  ddl: any,
): [string, Constraint][] {
  if (ddl.type != "statement" || ddl.variant != "list") {
    throw new Error("Encountered a non-statement or non-list DDL for table.");
  }
  return ddl.statement.flatMap((t: any) => {
    if (t.type != "statement" || t.variant != "create" || t.format != "table") {
      return [];
    }
    return t.definition.flatMap((c: any) => {
      if (
        c.type != "definition" ||
        c.variant != "constraint" ||
        c.definition.length != 1 ||
        c.definition[0].type != "constraint" ||
        c.definition[0].variant != "foreign key"
      ) {
        return [];
      }
      if (c.columns.length != 1) {
        return [];
      }

      const definition = c.definition[0];
      const sourceColumn = c.columns[0];

      if (
        sourceColumn.type != "identifier" ||
        sourceColumn.variant != "column"
      ) {
        return [];
      }

      if (
        definition.references == null ||
        definition.references.columns == null ||
        definition.references.columns.length != 1
      ) {
        return [];
      }

      const destinationColumn = definition.references.columns[0];
      const foreignTable = [definition.references.name];
      return [
        [
          `${tableName.join(".")}.${sourceColumn.name}->${
            definition.references.name
          }.${destinationColumn.name}`,
          {
            foreign_table: foreignTable,
            column_mapping: {
              [sourceColumn.name]: destinationColumn.name,
            },
          },
        ],
      ];
    });
  });
}

function getPrimaryKeyNames(
  description: { Name: string; Type: string }[],
): string[] {
  return (
    description.find(({ Name }) => Name == "primary key")?.Type.split(", ") ??
    []
  );
}

export async function getSchema(
  config: Config,
  sqlLogger: SqlLogger,
  schemaRequest: SchemaRequest = {},
): Promise<SchemaResponse> {
  return await withConnection(config, sqlLogger, async (db) => {
    const detailLevel = schemaRequest.detail_level ?? "everything";

    const results = await db.query(
      `SELECT 
        tables.table_schema,
        tables.table_name,
        tables.is_insertable_into::bool,
        ARRAY_AGG(JSONB_BUILD_OBJECT(
          'column_name', columns.column_name, 
          'data_type', columns.data_type,
          'is_nullable', columns.is_nullable::bool,
          'is_generated', columns.is_generated
        )) AS columns 
         FROM information_schema.tables 
         JOIN information_schema.columns ON columns.table_name = tables.table_name AND columns.table_schema = tables.table_schema
         WHERE tables.table_schema NOT IN ('pg_catalog', 'information_schema', 'rw_catalog') 
         GROUP BY tables.table_schema, tables.table_name, tables.is_insertable_into;`,
    );
    const resultsT: TableInfoInternal[] = results as TableInfoInternal[];
    const filtered: TableInfoInternal[] = resultsT.filter(
      includeTable(config, schemaRequest?.filters?.only_tables),
    );
    const result: [TableInfo, ObjectTypeDefinition[]][] = await Promise.all(
      filtered.map(formatTableInfo(db, config, detailLevel)),
    );
    const objectTypes = result.flatMap(([, objectTypes]) => objectTypes);
    const objectTypesObj = objectTypes.length
      ? {
          objectTypes: objectTypes,
        }
      : {};

    return {
      tables: result.map(([tableInfo]) => tableInfo),
      ...objectTypesObj,
    };
  });
}
