import type { FastifyRequest } from "fastify";
import type { ConfigSchemaResponse } from "@hasura/dc-api-types";

export type Config = {
  url: string;
};

export const getConfig = (request: FastifyRequest): Config => {
  return tryGetConfig(request) ?? { url: "" };
};

export const tryGetConfig = (request: FastifyRequest): Config | null => {
  const configHeader = request.headers["x-hasura-dataconnector-config"];
  const rawConfigJson = Array.isArray(configHeader)
    ? configHeader[0]
    : configHeader;
  const config = JSON.parse(rawConfigJson ?? "{}");

  if (config.url == null) {
    return null;
  }

  return {
    url: config.url,
  };
};

export const configSchema: ConfigSchemaResponse = {
  config_schema: {
    type: "object",
    nullable: false,
    properties: {
      url: {
        type: "string",
        description: "The postgres URL of the RisingWave instance",
      },
    },
  },
  other_schemas: {},
};
