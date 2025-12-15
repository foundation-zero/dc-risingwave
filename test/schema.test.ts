// See ./seed.sql for the database set up for these tests
import { afterAll, beforeAll, expect, test } from "bun:test";
import { withConnection } from "../src/db";

const HEADERS = {
  "Content-Type": "application/json",
  "X-Hasura-Admin-Secret": Bun.env.HASURA_ADMIN_SECRET ?? "",
};
const TEST_CONFIG = {
  url: Bun.env.RW_URL ?? "",
};

beforeAll(async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_add_source",
      args: {
        name: "Test",
        configuration: {
          value: { url: "postgresql://root@localhost:4566/dev" },
        },
      },
    }),
  });
  expect(response.status).toBe(200);
});

beforeAll(async () => {
  await withConnection(
    TEST_CONFIG,
    () => {},
    async (conn) => {
      const seedSql = await Bun.file("./test/seed.sql").text();
      await conn.exec(seedSql);
    },
  );
});

test("Primitive types", async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "primitive_types"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(response.status).toBe(200);

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_primitive_types(order_by: {id: asc}) {
            name
            age
            score
            is_active
          }
        }
      `,
    }),
  });

  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_primitive_types: [
        {
          name: "Alice",
          age: 30,
          score: 85.5,
          is_active: true,
        },
        {
          name: "Bob",
          age: 25,
          score: 90.0,
          is_active: false,
        },
      ],
    },
  });
});

test("Single nesting", async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "single_nesting"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(response.status).toBe(200);

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_single_nesting(where: {data: {number: {_gt: 10}}}) {
            id
            data {
              name
              number
            }
          }
        }
      `,
    }),
  });

  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_single_nesting: [
        {
          id: 1,
          data: {
            name: "Alice",
            number: 42,
          },
        },
      ],
    },
  });
});

test("Double nesting", async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "double_nesting"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(response.status).toBe(200);

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_double_nesting(order_by: {data: {info: {value: asc}}}) {
            id
            data {
              info {
                name: description
                number: value
              }
            }
          }
        }
      `,
    }),
  });
  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_double_nesting: [
        {
          id: 2,
          data: {
            info: {
              name: "Test 2",
              number: 2.71,
            },
          },
        },
        {
          id: 1,
          data: {
            info: {
              name: "Test 1",
              number: 3.14,
            },
          },
        },
      ],
    },
  });
});

test("Array of objects", async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "array_of_objects"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(response.status).toBe(200);

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_array_of_objects(order_by: {id: asc}) {
            id
            items {
              a
              b
            }
          }
        }
      `,
    }),
  });

  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_array_of_objects: [
        {
          id: 1,
          items: [
            { a: 1, b: 2 },
            { a: 3, b: 4 },
          ],
        },
        {
          id: 2,
          items: [
            { a: 5, b: 6 },
            { a: 7, b: 8 },
          ],
        },
      ],
    },
  });
});

test("Relations", async () => {
  // Track outgoing_relation and incoming_relation tables
  const trackResponse = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "outgoing_relation"],
            source: "Test",
            configuration: {},
          },
          {
            table: ["public", "incoming_relation"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(trackResponse.status).toBe(200);

  const versionResponse = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "export_metadata",
      args: {},
      version: 2,
    }),
  });
  const versionResult = await versionResponse.json();
  const resourceVersion = versionResult.resource_version;
  expect(versionResponse.status).toBe(200);

  const relationResponse = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "bulk_atomic",
      args: [
        {
          type: "risingwave_create_object_relationship",
          args: {
            table: ["public", "outgoing_relation"],
            name: "relate",
            source: "Test",
            using: {
              manual_configuration: {
                remote_table: ["public", "incoming_relation"],
                column_mapping: { other_id: "id" },
              },
            },
          },
        },
      ],
      resource_version: resourceVersion,
    }),
  });
  expect(relationResponse.status).toBe(200);

  await Bun.sleep(1000); // Wait a bit for the metadata to propagate

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_outgoing_relation(order_by: {id: asc}) {
            id
            relate {
              id
              name
            }
          }
        }
      `,
    }),
  });
  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_outgoing_relation: [
        {
          id: 1,
          relate: {
            id: 10,
            name: "Related A",
          },
        },
        {
          id: 2,
          relate: {
            id: 20,
            name: "Related B",
          },
        },
      ],
    },
  });
});

test("Materialized View", async () => {
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_track_tables",
      args: {
        allow_warnings: true,
        tables: [
          {
            table: ["public", "view_outgoing_relation"],
            source: "Test",
            configuration: {},
          },
        ],
      },
    }),
  });
  expect(response.status).toBe(200);

  const queryResponse = await fetch("http://localhost:8080/v1/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query: `
        query {
          public_view_outgoing_relation(order_by: {id: asc}) {
            id
            other_id
          }
        }
      `,
    }),
  });

  expect(queryResponse.status).toBe(200);
  const queryResult = await queryResponse.json();
  expect(queryResult).toEqual({
    data: {
      public_view_outgoing_relation: [
        {
          id: 1,
          other_id: 10,
        },
        {
          id: 2,
          other_id: 20,
        },
      ],
    },
  });
});

afterAll(async () => {
  // Call metadata risingwave_drop_source to clean up, args: name, cascade: true
  const response = await fetch("http://localhost:8080/v1/metadata", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      type: "risingwave_drop_source",
      args: { name: "Test", cascade: true },
    }),
  });
});
