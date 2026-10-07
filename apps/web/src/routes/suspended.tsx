import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { signOut } from "../server/functions/session";

export const Route = createFileRoute("/suspended")({ component: Suspended });

function Suspended() {
  const doSignOut = useServerFn(signOut);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Your account has been suspended</CardTitle>
          <CardDescription>
            An admin has suspended this account. If you believe this is a mistake, reach out to the
            neighbor who invited you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void doSignOut().then(() => {
                window.location.href = "/sign-in";
              });
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
