import { auth } from "@plumas/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Wrapped in a server function (not a bare `getRequest()` call) so it works correctly from
 * both SSR and client-side route navigations - server functions always execute on the server,
 * regardless of which context invoked them.
 */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await auth.api.signOut({ headers: getRequest().headers });
});
