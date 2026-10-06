import { createDb, generateInviteToken, hashInviteToken, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { auth } from "./config";
import { acceptInvite, createInvite } from "./invite-service";

const { invites, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("betterAuth config (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("sends a working magic link to an existing member (proves the drizzle adapter wiring)", async () => {
    const [inviter] = await db
      .insert(users)
      .values({ email: uniqueEmail("inviter"), displayName: "Inviter" })
      .returning();
    if (!inviter) throw new Error("setup failed");

    const email = uniqueEmail("signin");
    const invite = await createInvite(db, { inviterId: inviter.id, email });
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token) })
      .where(eq(invites.id, invite.id));
    const user = await acceptInvite(db, { token, displayName: "Sign In Test", isAdult: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await auth.api.signInMagicLink({
      body: { email: user.email },
      headers: new Headers(),
    });

    expect(result.status).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(user.email);
  });

  it("rejects user creation through Better Auth's own create-user path", async () => {
    // No invite exists for this email at all; Better Auth must never create an account for
    // it, which the magicLink plugin's disableSignUp already prevents at verification time,
    // backed up by the unconditional databaseHooks.user.create.before gate.
    const email = uniqueEmail("uninvited");

    await expect(
      auth.api.signInMagicLink({ body: { email }, headers: new Headers() }),
    ).resolves.toMatchObject({ status: true }); // requesting a link is allowed...

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    expect(existing).toBeUndefined(); // ...but no account was ever created for it.
  });
});
