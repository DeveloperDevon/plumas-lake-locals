import { acceptInvite, createAuth, InviteInvalidError, validateInviteToken } from "@plumas/auth";
import { inviteAcceptSchema, inviteTokenSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { getDb } from "../db";

/** FR-INV-03: used by /invite/accept's loader to show the locked email or a rejection. */
export const checkInviteToken = createServerFn({ method: "GET" })
  .validator(z.object({ token: inviteTokenSchema }))
  .handler(async ({ data }) => {
    try {
      const invite = await validateInviteToken(getDb(), data.token);
      return { valid: true as const, email: invite.email };
    } catch {
      return { valid: false as const };
    }
  });

/**
 * Creates the member row and its password credential (FR-INV-03/04/11), then signs them in
 * with that same password - acceptInvite itself never signs anyone in, since that call needs
 * real request headers.
 */
export const acceptInviteAndSignIn = createServerFn({ method: "POST" })
  .validator(inviteAcceptSchema)
  .handler(async ({ data }) => {
    try {
      const user = await acceptInvite(getDb(), data);
      await createAuth().api.signInEmail({
        body: { email: user.email, password: data.password },
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
