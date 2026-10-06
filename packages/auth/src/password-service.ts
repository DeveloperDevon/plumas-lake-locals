import { type Database, schema } from "@plumas/db";
import { and, eq, isNotNull } from "drizzle-orm";

const { accounts } = schema;

/** Whether this user can already sign in with a password (set at invite-accept time, or since). */
export async function hasPasswordCredential(database: Database, userId: string): Promise<boolean> {
  const [account] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, "credential"),
        isNotNull(accounts.password),
      ),
    );
  return account !== undefined;
}
