import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@plumas/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { getHasPassword, setPassword, signOut } from "../../../server/functions/session";

export const Route = createFileRoute("/_app/settings/account")({
  loader: async () => ({ hasPassword: await getHasPassword() }),
  component: Account,
});

function Account() {
  const { hasPassword } = Route.useLoaderData();
  const router = useRouter();

  const doSignOut = useServerFn(signOut);
  const doSetPassword = useServerFn(setPassword);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordState, setPasswordState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  async function refresh() {
    await router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      {hasPassword ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Set a password</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (newPassword !== confirmPassword) {
                  setPasswordState({ status: "error", message: "Passwords don't match." });
                  return;
                }
                setPasswordState({ status: "submitting" });
                void doSetPassword({ data: { password: newPassword } }).then((result) => {
                  if (result.ok) {
                    setNewPassword("");
                    setConfirmPassword("");
                    setPasswordState({ status: "idle" });
                    void refresh();
                  } else {
                    setPasswordState({ status: "error", message: result.message });
                  }
                });
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-new-password">Confirm password</Label>
                <Input
                  id="confirm-new-password"
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
              {passwordState.status === "error" ? (
                <p className="text-sm text-destructive">{passwordState.message}</p>
              ) : null}
              <Button type="submit" disabled={passwordState.status === "submitting"}>
                {passwordState.status === "submitting" ? "Saving..." : "Set password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              void doSignOut().then(() => router.navigate({ to: "/sign-in" }));
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
