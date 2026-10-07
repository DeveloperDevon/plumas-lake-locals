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
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { acceptInviteAndSignIn, checkInviteToken } from "../../server/functions/invite";

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
  const router = useRouter();
  const acceptInvite = useServerFn(acceptInviteAndSignIn);

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [state, setState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  const passwordsMatch = password.length > 0 && password === confirmPassword;

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
              if (!passwordsMatch) {
                setState({ status: "error", message: "Passwords don't match." });
                return;
              }
              setState({ status: "submitting" });
              void acceptInvite({ data: { token, displayName, password, isAdult } }).then(
                (result) => {
                  if (result.ok) {
                    void router.navigate({ to: "/feed" });
                  } else {
                    setState({ status: "error", message: result.message });
                  }
                },
              );
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
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
              <p className="text-sm text-destructive">{state.message}</p>
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
