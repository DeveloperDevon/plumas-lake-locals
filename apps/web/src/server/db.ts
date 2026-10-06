import { createDb } from "@plumas/db";

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * A fresh connection per call, never cached across requests - see @plumas/auth's
 * createAuth() doc comment for why: Workers forbids touching an I/O object from a request
 * other than the one that opened it, and a module-level cache would do exactly that.
 */
export function getDb() {
  return createDb(mustGetEnv("DATABASE_URL"));
}
