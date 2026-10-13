import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { NavRail, TabBar } from "../components/nav";
import { getUnreadNotificationCountFn } from "../server/functions/notifications";

const UNREAD_POLL_MS = 30_000;

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
  loader: async () => ({ unreadCount: await getUnreadNotificationCountFn() }),
  component: AppShell,
});

function AppShell() {
  const { user } = Route.useRouteContext();
  const { unreadCount: initialUnreadCount } = Route.useLoaderData();
  const isAdmin = user.role === "admin";

  // No push/websocket exists yet (FR-NOT-03 push is deferred) - polling is the simplest way to
  // keep the nav badge roughly live.
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const getUnreadCount = useServerFn(getUnreadNotificationCountFn);
  useEffect(() => {
    const interval = setInterval(() => {
      getUnreadCount()
        .then(setUnreadCount)
        .catch(() => undefined);
    }, UNREAD_POLL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [getUnreadCount]);

  return (
    <div className="flex min-h-screen">
      <NavRail userId={user.id} isAdmin={isAdmin} unreadCount={unreadCount} />
      <div className="min-w-0 flex-1 pb-16 lg:pb-0">
        <Outlet />
      </div>
      <TabBar userId={user.id} isAdmin={isAdmin} unreadCount={unreadCount} />
    </div>
  );
}
