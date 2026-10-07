import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: () => {
    // TanStack Router's redirect() is meant to be thrown; it isn't a plain Error subclass.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/settings/profile" });
  },
});
