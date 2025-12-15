import type { Config } from "./config";
import { withConnection, type SqlLogger } from "./db";
import type { RawRequest, RawResponse } from "@hasura/dc-api-types";

export async function runRawOperation(
  config: Config,
  sqlLogger: SqlLogger,
  query: RawRequest,
): Promise<RawResponse> {
  return await withConnection(config, sqlLogger, async (db) => {
    const results = await db.query(query.query);

    return {
      rows: (results || []) as Record<string, any>[],
    };
  });
}
