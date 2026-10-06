import { type Database, generateInviteToken, hashInviteToken, schema } from "@plumas/db";
import { sendInviteEmail } from "@plumas/email";
import { DEFAULT_MEMBER_INVITE_QUOTA, INVITE_EXPIRY_DAYS } from "@plumas/validators";
import { hashPassword } from "better-auth/crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";

const { accounts, invites, users } = schema;

export class InviteQuotaExceededError extends Error {
  constructor() {
    super("You've reached your invite quota.");
  }
}

export class InviteInvalidError extends Error {
  constructor(message = "This invite is no longer valid.") {
    super(message);
  }
}

function inviteUrl(token: string): string {
  const appUrl = process.env.PUBLIC_APP_URL;
  if (!appUrl) throw new Error("Missing required env var: PUBLIC_APP_URL");
  return `${appUrl}/invite/accept?token=${token}`;
}

function expiryDate(): Date {
  return new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export interface CreateInviteInput {
  inviterId: string;
  email: string;
  note?: string | undefined;
}

/** FR-INV-01/02/05: enforces the inviter's quota, mints a single-use token, sends the email. */
export async function createInvite(
  database: Database,
  { inviterId, email, note }: CreateInviteInput,
) {
  const [inviter] = await database.select().from(users).where(eq(users.id, inviterId));
  if (!inviter) throw new Error("Inviter not found");

  const quota = inviter.role === "admin" ? Infinity : DEFAULT_MEMBER_INVITE_QUOTA;
  const [outstanding] = await database
    .select({ value: count() })
    .from(invites)
    .where(
      and(eq(invites.inviterId, inviterId), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
    );
  if (!outstanding || outstanding.value >= quota) throw new InviteQuotaExceededError();

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const normalizedEmail = email.trim().toLowerCase();

  const [invite] = await database
    .insert(invites)
    .values({
      email: normalizedEmail,
      tokenHash,
      inviterId,
      note: note ?? null,
      expiresAt: expiryDate(),
    })
    .returning();
  if (!invite) throw new Error("Failed to create invite");

  await sendInviteEmail({
    to: normalizedEmail,
    url: inviteUrl(token),
    inviterName: inviter.displayName,
    note,
  });

  return invite;
}

/** FR-INV-06: lists an inviter's own invites, newest first. */
export async function listMyInvites(database: Database, inviterId: string) {
  return database
    .select()
    .from(invites)
    .where(eq(invites.inviterId, inviterId))
    .orderBy(desc(invites.createdAt));
}

async function findOwnInvite(database: Database, inviteId: string, actingUserId: string) {
  const [invite] = await database.select().from(invites).where(eq(invites.id, inviteId));
  if (!invite) throw new InviteInvalidError("Invite not found.");
  if (invite.inviterId !== actingUserId)
    throw new InviteInvalidError("You can't manage this invite.");
  return invite;
}

/** FR-INV-06: revokes a pending invite; a no-op guard once it's been accepted. */
export async function revokeInvite(database: Database, inviteId: string, actingUserId: string) {
  const invite = await findOwnInvite(database, inviteId, actingUserId);
  if (invite.acceptedAt) throw new InviteInvalidError("This invite has already been accepted.");

  const [updated] = await database
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(eq(invites.id, inviteId))
    .returning();
  if (!updated) throw new Error("Failed to revoke invite");
  return updated;
}

/** FR-INV-06: mints a fresh token and expiry, and re-sends the invite email. */
export async function resendInvite(database: Database, inviteId: string, actingUserId: string) {
  const invite = await findOwnInvite(database, inviteId, actingUserId);
  if (invite.acceptedAt) throw new InviteInvalidError("This invite has already been accepted.");
  if (invite.revokedAt) throw new InviteInvalidError("This invite has been revoked.");

  const [inviter] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (!inviter) throw new Error("Inviter not found");

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);

  const [updated] = await database
    .update(invites)
    .set({ tokenHash, expiresAt: expiryDate() })
    .where(eq(invites.id, inviteId))
    .returning();
  if (!updated) throw new Error("Failed to resend invite");

  await sendInviteEmail({
    to: updated.email,
    url: inviteUrl(token),
    inviterName: inviter.displayName,
    note: updated.note ?? undefined,
  });

  return updated;
}

/**
 * FR-INV-03: the only check that decides whether a token may be used to sign up — not
 * expired, not revoked, not already accepted. Looked up by hash; the raw token is never
 * stored.
 */
export async function validateInviteToken(database: Database, token: string) {
  const tokenHash = hashInviteToken(token);
  const [invite] = await database.select().from(invites).where(eq(invites.tokenHash, tokenHash));

  if (!invite) throw new InviteInvalidError();
  if (invite.revokedAt) throw new InviteInvalidError();
  if (invite.acceptedAt) throw new InviteInvalidError();
  if (invite.expiresAt.getTime() < Date.now()) throw new InviteInvalidError();

  return invite;
}

export interface AcceptInviteInput {
  token: string;
  displayName: string;
  password: string;
  isAdult: boolean;
}

/**
 * FR-INV-03/04/11: the only path that creates a user row (see config.ts's databaseHooks for
 * the corresponding defense-in-depth gate on Better Auth's own create-user path). Sets
 * invitedBy from the invite and stamps the 18+ attestation; does not sign the member in —
 * the caller does that afterward, since it needs the real request headers.
 *
 * Also creates the matching `accounts` row for password sign-in, hashed the same way Better
 * Auth's own /sign-up/email route does internally (providerId "credential", accountId = the
 * user's own id) - that endpoint itself stays disabled (config.ts's
 * emailAndPassword.disableSignUp), so this is the only path that can create one, mirroring
 * how magic-link accounts are gated.
 */
export async function acceptInvite(
  database: Database,
  { token, displayName, password, isAdult }: AcceptInviteInput,
) {
  if (!isAdult) throw new InviteInvalidError("You must confirm you are 18 or older.");

  const invite = await validateInviteToken(database, token);

  const [user] = await database
    .insert(users)
    .values({
      email: invite.email,
      displayName,
      invitedBy: invite.inviterId,
      ageAttestedAt: new Date(),
      emailVerified: false,
    })
    .returning();
  if (!user) throw new Error("Failed to create user");

  const passwordHash = await hashPassword(password);
  await database.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: passwordHash,
  });

  await database.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));

  return user;
}
