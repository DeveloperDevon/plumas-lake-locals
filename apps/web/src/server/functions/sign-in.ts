import { createAuth } from "@plumas/auth";
import { magicLinkRequestSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * FR-INV-07: sign-in via magic link for an existing member. disableSignUp on the magicLink
 * plugin (packages/auth/src/config.ts) means this can never create an account - only
 * /invite/accept's acceptInviteAndSendMagicLink does that.
 */
export const requestSignInLink = createServerFn({ method: "POST" })
  .validator(magicLinkRequestSchema)
  .handler(async ({ data }) => {
    await createAuth().api.signInMagicLink({
      body: { email: data.email, callbackURL: "/home" },
      headers: getRequest().headers,
    });
    return { sent: true };
  });
