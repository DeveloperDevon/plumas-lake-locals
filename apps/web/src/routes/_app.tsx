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
    return { user: context.session.user };
  },
  component: AppShell,
});

function AppShell() {
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="min-w-0 flex-1 pb-16 lg:pb-0">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}
