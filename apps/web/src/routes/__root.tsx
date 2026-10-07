import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { getSession } from "../server/functions/session";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  // Fetched once here (not per-page) so every route - including public ones a signed-in user
  // might still land on - can read the session from context instead of each re-querying it;
  // _app.tsx's own beforeLoad reads context.session rather than calling getSession() again.
  // Also what lets RootDocument set the right data-theme before any HTML is sent, with no
  // client-side flash of the wrong theme.
  beforeLoad: async () => {
    const session = await getSession();
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // NFR-07: no content is publicly indexable, even on the handful of unauthenticated
      // pages (landing, legal) - belt-and-suspenders with public/robots.txt.
      { name: "robots", content: "noindex, nofollow" },
      { title: "Plumas Lake Locals" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  const { session } = Route.useRouteContext();
  const theme = session?.user.theme;
  // "system" (or signed out) omits the attribute entirely, leaving it to the
  // prefers-color-scheme media query in packages/ui/src/styles/globals.css - only an explicit
  // light/dark choice is ever stamped here.
  const dataTheme = theme === "light" || theme === "dark" ? theme : undefined;

  return (
    <html lang="en" data-theme={dataTheme}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
