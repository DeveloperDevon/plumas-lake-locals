import { createAuth } from "@plumas/auth";
import { magicLinkRequestSchema, signInPasswordSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { APIError } from "better-auth";

/**
 * FR-INV-07: sign-in via magic link for an existing member. disableSignUp on the magicLink
 * plugin (packages/auth/src/config.ts) means this can never create an account - only
 * /invite/accept's acceptInviteAndSendMagicLink does that.
 */
export const requestSignInLink = createServerFn({ method: "POST" })
  .validator(magicLinkRequestSchema)
  .handler(async ({ data }) => {
    await createAuth().api.signInMagicLink({
      body: { email: data.email, callbackURL: "/feed" },
      headers: getRequest().headers,
    });
    return { sent: true };
  });

/**
 * Sign in with the password set at invite-accept time. disableSignUp on emailAndPassword
 * (packages/auth/src/config.ts) means /sign-up/email stays dead - only acceptInvite in
 * invite-service.ts can ever create the credential account this checks against.
 */
export const signInWithPassword = createServerFn({ method: "POST" })
  .validator(signInPasswordSchema)
  .handler(async ({ data }) => {
    try {
      await createAuth().api.signInEmail({
        body: { email: data.email, password: data.password },
        headers: getRequest().headers,
      });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof APIError) {
        // Generic on purpose - don't reveal whether the email exists.
        return { ok: false as const, message: "Incorrect email or password." };
      }
      throw error;
    }
  });
