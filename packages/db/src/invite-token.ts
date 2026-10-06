import { createHash, randomBytes } from "node:crypto";

/** FR-INV-02: a single-use invite token — 32 random bytes, base64url-encoded (~43 chars). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is ever stored (`invites.token_hash`); the raw token is never persisted. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
