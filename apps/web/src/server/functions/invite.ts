import { acceptInvite, auth, InviteInvalidError, validateInviteToken } from "@plumas/auth";
import { db } from "@plumas/db";
import { inviteAcceptSchema, inviteTokenSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

/** FR-INV-03: used by /invite/accept's loader to show the locked email or a rejection. */
export const checkInviteToken = createServerFn({ method: "GET" })
  .validator(z.object({ token: inviteTokenSchema }))
  .handler(async ({ data }) => {
    try {
      const invite = await validateInviteToken(db(), data.token);
      return { valid: true as const, email: invite.email };
    } catch {
      return { valid: false as const };
    }
  });

/**
 * Creates the member row (FR-INV-03/04/11), then sends a magic link so they finish signing in
 * - acceptInvite itself never signs anyone in, since that call needs real request headers.
 */
export const acceptInviteAndSendMagicLink = createServerFn({ method: "POST" })
  .validator(inviteAcceptSchema)
  .handler(async ({ data }) => {
    try {
      const user = await acceptInvite(db(), data);
      await auth.api.signInMagicLink({
        body: { email: user.email, callbackURL: "/home" },
        headers: getRequest().headers,
      });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof InviteInvalidError) {
        return { ok: false as const, message: error.message };
      }
      throw error;
    }
  });
