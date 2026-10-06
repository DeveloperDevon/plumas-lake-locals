import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): Database {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

let cachedDb: Database | undefined;

/** A lazily-created singleton for scripts/tests that just need one connection off DATABASE_URL. */
export function db(): Database {
  cachedDb ??= createDb(mustGetEnv("DATABASE_URL"));
  return cachedDb;
}

/**
 * Runs `fn` inside a transaction with `app.current_user_id` set for its duration, so Postgres
 * row-level security policies (NFR-06) can scope rows to the calling member. This is
 * defense-in-depth on top of, not instead of, explicit WHERE clauses in application queries.
 */
export async function withRequestContext<T>(
  database: Database,
  userId: string | null,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    if (userId) {
      await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    }
    return fn(tx);
  });
}

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
