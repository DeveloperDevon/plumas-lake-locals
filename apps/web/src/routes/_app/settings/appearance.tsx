import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@plumas/ui";
import type { Theme } from "@plumas/validators";
import { themes } from "@plumas/validators";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { setTheme } from "../../../server/functions/session";

export const Route = createFileRoute("/_app/settings/appearance")({ component: Appearance });

const themeLabels: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function Appearance() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const doSetTheme = useServerFn(setTheme);

  // Reflects the session's persisted value by default; updated optimistically on click, ahead
  // of the server round-trip, so the picker itself never looks like it lagged.
  const [current, setCurrent] = useState<Theme>((user.theme as Theme | undefined) ?? "system");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose how Plumas Lake Locals looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {themes.map((theme) => (
            <Button
              key={theme}
              type="button"
              variant={theme === current ? "default" : "outline"}
              onClick={() => {
                setCurrent(theme);
                // Applied immediately client-side; the next full navigation's SSR already
                // reflects it too once setTheme's write lands (see __root.tsx). Absence of
                // the attribute (not an empty one) is what lets the prefers-color-scheme
                // media query take over for "system".
                if (theme === "system") {
                  delete document.documentElement.dataset.theme;
                } else {
                  document.documentElement.dataset.theme = theme;
                }
                void doSetTheme({ data: { theme } }).then(() => router.invalidate());
              }}
            >
              {themeLabels[theme]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
