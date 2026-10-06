import { createDb, schema } from "@plumas/db";

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

export function testDb() {
  return createDb(mustGetEnv("DATABASE_URL"));
}

export function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

/**
 * A member inserted directly via the database, standing in for an already-onboarded
 * neighbor. Deliberately does not go through @plumas/auth's createInvite/acceptInvite here -
 * those pull in @plumas/email's React Email templates (.tsx), and Playwright's own JSX
 * handling for test files conflicts with react-dom/server when that chain runs inside the
 * test process. Invites are created through the real UI in tests instead (see helpers/ui.ts),
 * which is both more representative of an actual user flow and avoids the conflict entirely.
 */
export async function seedMember(role: "member" | "admin" = "member") {
  const db = testDb();
  const [user] = await db
    .insert(schema.users)
    .values({ email: uniqueEmail(`e2e-${role}`), displayName: `E2E ${role}`, role })
    .returning();
  if (!user) throw new Error("Failed to seed a member");
  return user;
}
