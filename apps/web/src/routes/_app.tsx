import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

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
  component: Outlet,
});
