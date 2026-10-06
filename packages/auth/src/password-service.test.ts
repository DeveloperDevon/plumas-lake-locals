import { createDb, schema } from "@plumas/db";
import { hashPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import { hasPasswordCredential } from "./password-service";

const { accounts, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("hasPasswordCredential (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  it("is false for a user with no credential account", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("no-password"), displayName: "No Password" })
      .returning();
    if (!user) throw new Error("setup failed");

    await expect(hasPasswordCredential(db, user.id)).resolves.toBe(false);
  });

  it("is false for an unknown user id", async () => {
    await expect(hasPasswordCredential(db, crypto.randomUUID())).resolves.toBe(false);
  });

  it("is true once a credential account with a password exists", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("has-password"), displayName: "Has Password" })
      .returning();
    if (!user) throw new Error("setup failed");

    await db.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword("correct-horse-battery"),
    });

    await expect(hasPasswordCredential(db, user.id)).resolves.toBe(true);
  });
});
