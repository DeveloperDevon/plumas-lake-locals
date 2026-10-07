import { type Database, schema } from "@plumas/db";
import type { Theme } from "@plumas/validators";
import { eq } from "drizzle-orm";

const { users } = schema;

export async function setUserTheme(database: Database, userId: string, theme: Theme) {
  await database.update(users).set({ theme }).where(eq(users.id, userId));
}
