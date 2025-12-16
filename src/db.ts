import { type Config } from "./config";
import { Pool } from "pg";

const pools = new Map<string, Pool>();

export type SqlLogger = (sql: string) => void;

export type Connection = {
  query: (
    query: string,
    params?: Record<string, unknown>,
  ) => Promise<Array<any>>;
  exec: (sql: string) => Promise<void>;
  withTransaction: <Result>(action: () => Promise<Result>) => Promise<Result>;
};

function ensurePool(config: Config): Pool {
  const pool =
    pools.get(config.url) ??
    new Pool({
      connectionString: config.url,
      password: "",
    });
  pools.set(config.url, pool);
  return pool;
}

export async function withConnection<Result>(
  config: Config,
  sqlLogger: SqlLogger,
  useConnection: (connection: Connection) => Promise<Result>,
): Promise<Result> {
  const client = await ensurePool(config).connect();

  const query = async (query: string, params?: Record<string, unknown>) => {
    const start = Date.now();
    const res = await client.query(query, Object.values(params ?? {}));
    const duration = Date.now() - start;
    sqlLogger(`${query} - ${duration}ms`);
    return res.rows;
  };

  const exec = async (sql: string) => {
    await query(sql); // In pg, exec is same as query
  };

  const withTransaction = async <Result>(
    action: () => Promise<Result>,
  ): Promise<Result> => {
    await exec("BEGIN TRANSACTION");
    try {
      const result = await action();
      await exec("COMMIT");
      return result;
    } catch (err) {
      await exec("ROLLBACK");
      throw err;
    }
  };

  try {
    return await useConnection({ query, exec, withTransaction });
  } finally {
    client.release();
  }
}
