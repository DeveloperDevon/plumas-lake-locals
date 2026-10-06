import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// postgres-js, not node-postgres: node-postgres's wire-protocol handling hangs on
// INSERT/UPDATE ... RETURNING under Cloudflare Workers' simulated TCP sockets (workerd),
// confirmed by a diagnostic route while building apps/web - plain SELECTs and
// RETURNING-less writes worked, anything with RETURNING hung until the Workers runtime
// killed the request. postgres-js's protocol implementation doesn't have this problem, and
// works identically under plain Node for migrate/seed/tests. See docs/adr/0002.
//
// max: 1 + a short idle_timeout: a Worker isolate can be reused across many unrelated
// requests, and Workers forbids touching an I/O object (a socket included) from a request
// other than the one that opened it - so every caller here gets its own small, short-lived
// connection rather than a pooled one shared across calls. apps/web calls createDb() fresh
// per request for this reason (see its src/server/db.ts); only one-shot Node processes
// (migrate, seed) are safe to use the db() singleton below.
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 1, idle_timeout: 5 });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

let cachedDb: Database | undefined;

/**
 * A lazily-created singleton for one-shot Node processes (migrate.ts, seed.ts) and tests that
 * exit or finish shortly after a single unit of work. Never import this into apps/web's
 * request-handling code - see createDb's comment above.
 */
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
