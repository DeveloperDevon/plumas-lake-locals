import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from "@plumas/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { acceptInviteAndSendMagicLink, checkInviteToken } from "../../server/functions/invite";

export const Route = createFileRoute("/invite/accept")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    if (!deps.token) return { valid: false as const };
    try {
      return await checkInviteToken({ data: { token: deps.token } });
    } catch {
      // A malformed token (wrong length/shape) fails validation before even reaching the
      // database - treat it the same as an unknown token rather than a server error.
      return { valid: false as const };
    }
  },
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token } = Route.useSearch();
  const invite = Route.useLoaderData();
  const acceptInvite = useServerFn(acceptInviteAndSendMagicLink);

  const [displayName, setDisplayName] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "sent" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  if (!invite.valid || !token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>This invite is no longer valid</CardTitle>
            <CardDescription>
              It may have expired, already been used, or been revoked. Ask your neighbor for a new
              invite.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (state.status === "sent") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a sign-in link to {invite.email}. Open it to finish joining.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Join Plumas Lake Locals</CardTitle>
          <CardDescription>You were invited as {invite.email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setState({ status: "submitting" });
              void acceptInvite({ data: { token, displayName, isAdult } }).then((result) => {
                if (result.ok) {
                  setState({ status: "sent" });
                } else {
                  setState({ status: "error", message: result.message });
                }
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={invite.email} disabled readOnly />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                required
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                placeholder="Jordan L."
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isAdult"
                checked={isAdult}
                onCheckedChange={(checked) => {
                  setIsAdult(checked === true);
                }}
              />
              <Label htmlFor="isAdult">I am 18 or older</Label>
            </div>
            {state.status === "error" ? (
              <p className="text-sm text-red-600">{state.message}</p>
            ) : null}
            <Button type="submit" disabled={!isAdult || state.status === "submitting"}>
              {state.status === "submitting" ? "Joining..." : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
