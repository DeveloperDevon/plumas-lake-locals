import { eq } from "drizzle-orm";

import type { Database } from "../client";
import { generateInviteToken, hashInviteToken } from "../invite-token";
import { invites, users } from "../schema";

const INVITE_EXPIRY_DAYS = 7;

/** Idempotent: re-running with the same email reuses the existing admin row. */
export async function ensureAdminUser(database: Database, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const [existing] = await database.select().from(users).where(eq(users.email, normalized));
  if (existing) return existing.id;

  const [created] = await database
    .insert(users)
    .values({
      email: normalized,
      displayName: "Admin",
      role: "admin",
      status: "active",
      ageAttestedAt: new Date(),
    })
    .returning();
  if (!created) throw new Error("Failed to create admin user");
  return created.id;
}

/**
 * Creates a signed invite for `email` and returns the raw token (never recoverable once this
 * returns, since only its hash is stored). If an unaccepted, unrevoked invite already exists
 * for that email, no duplicate is created — revoke the existing one first to get a new link.
 */
export async function ensureSeedInvite(
  database: Database,
  inviterId: string,
  email: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const [existingPending] = await database
    .select()
    .from(invites)
    .where(eq(invites.email, normalized));
  if (existingPending && !existingPending.acceptedAt && !existingPending.revokedAt) {
    return "(an invite is already pending for this email — revoke it first to get a new link)";
  }

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await database.insert(invites).values({ email: normalized, tokenHash, inviterId, expiresAt });

  return token;
}
