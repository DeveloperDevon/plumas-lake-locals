import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getSession } from "../server/functions/session";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) {
      // TanStack Router's redirect() is meant to be thrown; it isn't a plain Error subclass.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/sign-in" });
    }
    return { user: session.user };
  },
  component: Outlet,
});
