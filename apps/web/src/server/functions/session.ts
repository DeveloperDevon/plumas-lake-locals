import { createAuth, hasPasswordCredential, setUserTheme } from "@plumas/auth";
import { setPasswordSchema, setThemeSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { APIError } from "better-auth";

import { requireUser } from "../auth";
import { getDb } from "../db";

/**
 * Wrapped in a server function (not a bare `getRequest()` call) so it works correctly from
 * both SSR and client-side route navigations - server functions always execute on the server,
 * regardless of which context invoked them.
 */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  return createAuth().api.getSession({ headers: getRequest().headers });
});

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await createAuth().api.signOut({ headers: getRequest().headers });
});

/** Drives /home's conditional "Set password" card - members invited before this feature (or
 * seeded directly, like the admin bootstrap user) have no credential account yet. */
export const getHasPassword = createServerFn({ method: "GET" }).handler(async () => {
  const session = await createAuth().api.getSession({ headers: getRequest().headers });
  if (!session) throw new Error("Not signed in");
  return hasPasswordCredential(getDb(), session.user.id);
});

/**
 * Better Auth's own setPassword (server-only, packages/auth's config.ts emailAndPassword) -
 * throws PASSWORD_ALREADY_SET if the account already has one, which is what backs the "only
 * if missing" gate here, not just the client hiding the form.
 */
export const setPassword = createServerFn({ method: "POST" })
  .validator(setPasswordSchema)
  .handler(async ({ data }) => {
    try {
      await createAuth().api.setPassword({
        body: { newPassword: data.password },
        headers: getRequest().headers,
      });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof APIError) {
        return { ok: false as const, message: "Could not set a password. Please try again." };
      }
      throw error;
    }
  });

/**
 * Written directly via Drizzle (theme-service.ts), not Better Auth's updateUser - `theme` is
 * declared input:false (packages/auth/src/config.ts) specifically so it can't be set through
 * that public endpoint, only here, scoped to the caller's own session user id.
 */
export const setTheme = createServerFn({ method: "POST" })
  .validator(setThemeSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setUserTheme(getDb(), user.id, data.theme);
    return { ok: true as const };
  });
