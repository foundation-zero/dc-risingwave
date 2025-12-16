import { configSchema } from "./config";

import type {
  CapabilitiesResponse,
  ScalarTypeCapabilities,
} from "@hasura/dc-api-types";

// NOTE: This should cover all possible schema types.
//       This type should be a subtype of ScalarType.
export type ScalarTypeKey = "DateTime" | "string" | "number" | "bool";

// TODO: How can we ensure that we have covered all of the operator keys in the query module?
const scalar_types: Record<ScalarTypeKey, ScalarTypeCapabilities> = {
  DateTime: {
    comparison_operators: {
      _in_year: "int",
    },
    graphql_type: "String",
  },
  string: {
    comparison_operators: {
      // See: https://www.sqlite.org/lang_expr.html #5
      _like: "string",
      _glob: "string",
      // _regexp: 'string', // TODO: Detect if REGEXP is supported
    },
    aggregate_functions: {
      max: "string",
      min: "string",
    },
    graphql_type: "String",
  },
  number: {
    comparison_operators: {
      _modulus_is_zero: "number",
    },
    aggregate_functions: {
      max: "number",
      min: "number",
      sum: "number",
    },
    update_column_operators: {
      inc: {
        argument_type: "number",
      },
      dec: {
        argument_type: "number",
      },
    },
    graphql_type: "Float",
  },
  bool: {
    comparison_operators: {
      _and: "bool",
      _or: "bool",
      _nand: "bool",
      _xor: "bool",
    },
    graphql_type: "Boolean",
  },
};

export const capabilitiesResponse: CapabilitiesResponse = {
  display_name: "Risingwave",
  config_schemas: configSchema,
  capabilities: {
    data_schema: {
      supports_primary_keys: true,
      supports_foreign_keys: false,
      column_nullability: "nullable_and_non_nullable",
    },
    post_schema: {},
    scalar_types,
    queries: {
      foreach: {},
    },
    relationships: {},
    interpolated_queries: {},
    comparisons: {
      subquery: {
        supports_relations: true,
      },
    },
    explain: {},
    raw: {},
  },
};
