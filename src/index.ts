import Fastify from "fastify";
import FastifyCors from "@fastify/cors";
import { getSchema } from "./schema";
import { explain, queryData } from "./query";
import { getConfig, tryGetConfig } from "./config";
import { capabilitiesResponse } from "./capabilities";
import type {
  QueryResponse,
  SchemaResponse,
  QueryRequest,
  CapabilitiesResponse,
  ExplainResponse,
  RawRequest,
  RawResponse,
  ErrorResponse,
  MutationRequest,
  MutationResponse,
  DatasetTemplateName,
  DatasetGetTemplateResponse,
  DatasetCreateCloneRequest,
  DatasetCreateCloneResponse,
  DatasetDeleteCloneResponse,
  SchemaRequest,
} from "@hasura/dc-api-types";
import { withConnection } from "./db";
import metrics from "fastify-metrics";
import prometheus from "prom-client";
import { runRawOperation } from "./raw";
import {
  LOG_LEVEL,
  METRICS,
  PERMISSIVE_CORS,
  PRETTY_PRINT_LOGS,
} from "./environment";
import { ErrorWithStatusCode, unreachable } from "./util";

const port = Number(process.env.PORT) || 8100;

// NOTE: Pretty printing for logs is no longer supported out of the box.
// See: https://github.com/pinojs/pino-pretty#integration
// Pretty printed logs will be enabled if you have the `pino-pretty`
// dev dependency installed as per the package.json settings.
const server = Fastify({
  logger: {
    level: LOG_LEVEL,
    ...(PRETTY_PRINT_LOGS ? { transport: { target: "pino-pretty" } } : {}),
  },
});

server.setErrorHandler(function (error, _request, reply) {
  // Log error
  this.log.error(error);

  if (error instanceof ErrorWithStatusCode) {
    const errorResponse: ErrorResponse = {
      type: error.type,
      message: error.message,
      details: error.details,
    };
    reply.status(error.code).send(errorResponse);
  } else {
    const errorResponse: ErrorResponse = {
      type: "uncaught-error",
      message: "SQLite Agent: Uncaught Exception",
      details: {
        name: error.name,
        message: error.message,
      },
    };
    reply.status(500).send(errorResponse);
  }
});

if (METRICS) {
  // See: https://www.npmjs.com/package/fastify-metrics
  server.register(metrics, {
    endpoint: "/metrics",
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: false,
    },
  });
}

if (PERMISSIVE_CORS) {
  // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin
  server.register(FastifyCors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "X-Hasura-DataConnector-Config",
      "X-Hasura-DataConnector-SourceName",
    ],
  });
}

// Register request-hook metrics.
// This is done in a closure so that the metrics are scoped here.
(() => {
  if (!METRICS) {
    return;
  }

  const requestCounter = new prometheus.Counter({
    name: "http_request_count",
    help: "Number of requests",
    labelNames: ["route"],
  });

  // Register a global request counting metric
  // See: https://www.fastify.io/docs/latest/Reference/Hooks/#onrequest
  server.addHook("onRequest", async (request, reply) => {
    requestCounter.inc({ route: request.routerPath });
  });
})();

// This is a hack to get Fastify to parse bodies on /schema GET requests
// We basically trick its code into thinking the request is actually a POST
// request so it doesn't skip parsing request bodies.
server.addHook("onRequest", async (request, reply) => {
  if (request.routerPath === "/schema") request.raw.method = "POST";
});

// Serves as an example of a custom histogram
// Not especially useful at present as this mirrors
// http_request_duration_seconds_bucket but is less general
// but the query endpoint will offer more statistics specific
// to the database interactions in future.
const queryHistogram = new prometheus.Histogram({
  name: "query_durations",
  help: "Histogram of the duration of query response times.",
  buckets: prometheus.exponentialBuckets(0.0001, 10, 8),
  labelNames: ["route"] as const,
});

const sqlLogger = (sql: string): void => {
  server.log.debug({ sql }, "Executed SQL");
};

server.get<{ Reply: CapabilitiesResponse }>(
  "/capabilities",
  async (request, _response) => {
    server.log.info(
      { headers: request.headers, query: request.body },
      "capabilities.request",
    );
    return capabilitiesResponse;
  },
);

server.post<{ Body: SchemaRequest | undefined; Reply: SchemaResponse }>(
  "/schema",
  async (request, _response) => {
    server.log.info(
      { headers: request.headers, query: request.body },
      "schema.request",
    );
    const config = getConfig(request);
    const schema = await getSchema(config, sqlLogger, request.body);
    server.log.debug({ schema: schema }, "schema.response");
    return schema;
  },
);

/**
 * @throws ErrorWithStatusCode
 */
server.post<{ Body: QueryRequest; Reply: QueryResponse }>(
  "/query",
  async (request, response) => {
    server.log.info(
      { headers: request.headers, query: request.body },
      "query.request",
    );
    const end = queryHistogram.startTimer();
    const config = getConfig(request);
    const body = request.body;
    switch (body.target.type) {
      case "function":
        throw new ErrorWithStatusCode(
          "User defined functions not supported in queries",
          500,
          { function: { name: body.target.name } },
        );
      case "interpolated": // interpolated should actually work identically to tables when using the CTE pattern
      case "table":
        try {
          const result: QueryResponse = await queryData(
            config,
            sqlLogger,
            body,
          );
          return result;
        } finally {
          end();
        }
    }
  },
);

// TODO: Use derived types for body and reply
server.post<{ Body: RawRequest; Reply: RawResponse }>(
  "/raw",
  async (request, _response) => {
    server.log.info(
      { headers: request.headers, query: request.body },
      "schema.raw",
    );
    const config = getConfig(request);
    return runRawOperation(config, sqlLogger, request.body);
  },
);

server.post<{ Body: QueryRequest; Reply: ExplainResponse }>(
  "/explain",
  async (request, _response) => {
    server.log.info(
      { headers: request.headers, query: request.body },
      "query.request",
    );
    const config = getConfig(request);
    const body = request.body;
    switch (body.target.type) {
      case "function":
        throw new ErrorWithStatusCode(
          "User defined functions not supported in queries",
          500,
          { function: { name: body.target.name } },
        );
      case "table":
        return explain(config, sqlLogger, body);
      case "interpolated":
        return explain(config, sqlLogger, body);
      default:
        throw unreachable;
    }
  },
);

server.get("/health", async (request, response) => {
  const config = tryGetConfig(request);
  response.type("application/json");

  if (config === null) {
    server.log.info(
      { headers: request.headers, query: request.body },
      "health.request",
    );
    response.statusCode = 204;
  } else {
    server.log.info(
      { headers: request.headers, query: request.body },
      "health.db.request",
    );
    return await withConnection(config, sqlLogger, async (db) => {
      const r = await db.query("select 1 where 1 = 1");
      if (r && JSON.stringify(r) == '[{"1":1}]') {
        response.statusCode = 204;
      } else {
        response.statusCode = 500;
        return { error: "problem executing query", query_result: r };
      }
    });
  }
});

server.get("/", async (request, response) => {
  response.type("text/html");
  return `<!DOCTYPE html>
    <html>
      <head>
        <title>Hasura Data Connectors SQLite Agent</title>
      </head>
      <body>
        <h1>Hasura Data Connectors SQLite Agent</h1>
        <p>See <a href="https://github.com/hasura/graphql-engine#hasura-graphql-engine">
          the GraphQL Engine repository</a> for more information.</p>
        <ul>
          <li><a href="/">GET / - This Page</a>
          <li><a href="/capabilities">GET /capabilities - Capabilities Metadata</a>
          <li><a href="/schema">GET /schema - Agent Schema</a>
          <li><a href="/query">POST /query - Query Handler</a>
          <li><a href="/mutation">POST /mutation - Mutation Handler</a>
          <li><a href="/raw">POST /raw - Raw Query Handler</a>
          <li><a href="/health">GET /health - Healthcheck</a>
          <li><a href="/metrics">GET /metrics - Prometheus formatted metrics</a>
        </ul>
      </body>
    </html>
  `;
});

process.on("SIGINT", () => {
  server.log.info("interrupted");
  process.exit(0);
});

const start = async () => {
  try {
    server.log.info(`STARTING on port ${port}`);
    await server.listen({ port: port, host: "0.0.0.0" });
  } catch (err) {
    server.log.fatal(err);
    process.exit(1);
  }
};
start();
