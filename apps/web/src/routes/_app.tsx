import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { NavRail, TabBar } from "../components/nav";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context }) => {
    // __root.tsx's own beforeLoad already fetched this - no need to query it again here.
    if (!context.session) {
      // TanStack Router's redirect() is meant to be thrown; it isn't a plain Error subclass.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/sign-in" });
    }
    // A clean redirect for navigation - requireUser() (apps/web/src/server/auth.ts) is the
    // real enforcement point that blocks every mutating server function, not this check.
    if (context.session.user.status !== "active") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/suspended" });
    }
    return { user: context.session.user };
  },
  component: AppShell,
});

function AppShell() {
  const { user } = Route.useRouteContext();
  const isAdmin = user.role === "admin";
  return (
    <div className="flex min-h-screen">
      <NavRail userId={user.id} isAdmin={isAdmin} />
      <div className="min-w-0 flex-1 pb-16 lg:pb-0">
        <Outlet />
      </div>
      <TabBar userId={user.id} isAdmin={isAdmin} />
    </div>
  );
}
