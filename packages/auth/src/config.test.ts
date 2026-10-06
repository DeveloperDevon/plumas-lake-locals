import { createDb, generateInviteToken, hashInviteToken, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createAuth } from "./config";
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
  // Safe to share one instance across tests under plain Node (unlike apps/web's request
  // handlers, nothing here simulates Workers' per-request I/O isolation).
  const auth = createAuth();

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
    const user = await acceptInvite(db, {
      token,
      displayName: "Sign In Test",
      password: "correct-horse-battery",
      isAdult: true,
    });

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

  it("signs in with the password set at invite-accept time (proves the emailAndPassword wiring)", async () => {
    const [inviter] = await db
      .insert(users)
      .values({ email: uniqueEmail("inviter"), displayName: "Inviter" })
      .returning();
    if (!inviter) throw new Error("setup failed");

    const email = uniqueEmail("password-signin");
    const invite = await createInvite(db, { inviterId: inviter.id, email });
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token) })
      .where(eq(invites.id, invite.id));
    const user = await acceptInvite(db, {
      token,
      displayName: "Password Sign In Test",
      password: "correct-horse-battery",
      isAdult: true,
    });

    const result = await auth.api.signInEmail({
      body: { email: user.email, password: "correct-horse-battery" },
      headers: new Headers(),
    });
    expect(result.user.email).toBe(user.email);

    await expect(
      auth.api.signInEmail({
        body: { email: user.email, password: "wrong-password" },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
  });

  it("rejects account creation through Better Auth's own sign-up-with-password path", async () => {
    const email = uniqueEmail("uninvited-password");

    await expect(
      auth.api.signUpEmail({
        body: { email, password: "correct-horse-battery", name: "Nope" },
        headers: new Headers(),
      }),
    ).rejects.toThrow();

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    expect(existing).toBeUndefined();
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
