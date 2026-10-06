import { createDb, generateInviteToken, hashInviteToken, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  acceptInvite,
  createInvite,
  InviteInvalidError,
  InviteQuotaExceededError,
  listMyInvites,
  resendInvite,
  revokeInvite,
  validateInviteToken,
} from "./invite-service";

const { invites, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("invite-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  beforeAll(() => {
    // Console-fallback email transport (no RESEND_API_KEY in test env) - silence the noise.
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  async function makeMember(role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(role), displayName: `Test ${role}`, role })
      .returning();
    if (!user) throw new Error("failed to create test user");
    return user;
  }

  it("creates an invite and lists it for the inviter", async () => {
    const inviter = await makeMember();
    const email = uniqueEmail("invitee");

    const invite = await createInvite(db, { inviterId: inviter.id, email, note: "hi" });

    expect(invite.email).toBe(email);
    expect(invite.acceptedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();

    const mine = await listMyInvites(db, inviter.id);
    expect(mine.some((i) => i.id === invite.id)).toBe(true);
  });

  it("enforces the default member quota", async () => {
    const inviter = await makeMember();

    for (let i = 0; i < 10; i++) {
      await createInvite(db, { inviterId: inviter.id, email: uniqueEmail(`quota-${String(i)}`) });
    }

    await expect(
      createInvite(db, { inviterId: inviter.id, email: uniqueEmail("quota-overflow") }),
    ).rejects.toThrow(InviteQuotaExceededError);
  });

  it("admins are not subject to the quota", async () => {
    const admin = await makeMember("admin");

    for (let i = 0; i < 11; i++) {
      await createInvite(db, {
        inviterId: admin.id,
        email: uniqueEmail(`admin-quota-${String(i)}`),
      });
    }

    await expect(
      createInvite(db, { inviterId: admin.id, email: uniqueEmail("admin-quota-extra") }),
    ).resolves.toBeDefined();
  });

  it("revokes a pending invite and blocks acceptance afterward", async () => {
    const inviter = await makeMember();
    const invite = await createInvite(db, { inviterId: inviter.id, email: uniqueEmail("revokee") });

    // The raw token isn't returned by createInvite (only its hash is stored); mint our own
    // row directly to get a token we can assert against for this test.
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token) })
      .where(eq(invites.id, invite.id));

    const revoked = await revokeInvite(db, invite.id, inviter.id);
    expect(revoked.revokedAt).not.toBeNull();

    await expect(validateInviteToken(db, token)).rejects.toThrow(InviteInvalidError);
    await expect(acceptInvite(db, { token, displayName: "Nope", isAdult: true })).rejects.toThrow(
      InviteInvalidError,
    );
  });

  it("another member can't revoke someone else's invite", async () => {
    const inviter = await makeMember();
    const bystander = await makeMember();
    const invite = await createInvite(db, {
      inviterId: inviter.id,
      email: uniqueEmail("protected"),
    });

    await expect(revokeInvite(db, invite.id, bystander.id)).rejects.toThrow(InviteInvalidError);
  });

  it("resend mints a new token and the old one stops working", async () => {
    const inviter = await makeMember();
    const invite = await createInvite(db, { inviterId: inviter.id, email: uniqueEmail("resend") });

    const oldToken = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(oldToken) })
      .where(eq(invites.id, invite.id));

    await resendInvite(db, invite.id, inviter.id);

    await expect(validateInviteToken(db, oldToken)).rejects.toThrow(InviteInvalidError);
  });

  it("rejects an expired invite", async () => {
    const inviter = await makeMember();
    const invite = await createInvite(db, { inviterId: inviter.id, email: uniqueEmail("expired") });
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, invite.id));

    await expect(validateInviteToken(db, token)).rejects.toThrow(InviteInvalidError);
  });

  it("rejects an unknown token", async () => {
    await expect(validateInviteToken(db, generateInviteToken())).rejects.toThrow(
      InviteInvalidError,
    );
  });

  it("accepts a valid invite, creates the user, and marks it accepted", async () => {
    const inviter = await makeMember();
    const email = uniqueEmail("accepted");
    const invite = await createInvite(db, { inviterId: inviter.id, email });
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token) })
      .where(eq(invites.id, invite.id));

    const user = await acceptInvite(db, { token, displayName: "Jordan L.", isAdult: true });

    expect(user.email).toBe(email);
    expect(user.invitedBy).toBe(inviter.id);
    expect(user.ageAttestedAt).not.toBeNull();
    expect(user.emailVerified).toBe(false);

    const [updatedInvite] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(updatedInvite?.acceptedAt).not.toBeNull();

    // The token is single-use - a second attempt must fail.
    await expect(
      acceptInvite(db, { token, displayName: "Someone else", isAdult: true }),
    ).rejects.toThrow(InviteInvalidError);
  });

  it("rejects acceptance without the 18+ attestation", async () => {
    const inviter = await makeMember();
    const invite = await createInvite(db, {
      inviterId: inviter.id,
      email: uniqueEmail("underage"),
    });
    const token = generateInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token) })
      .where(eq(invites.id, invite.id));

    await expect(
      acceptInvite(db, { token, displayName: "Too Young", isAdult: false }),
    ).rejects.toThrow(InviteInvalidError);
  });
});
