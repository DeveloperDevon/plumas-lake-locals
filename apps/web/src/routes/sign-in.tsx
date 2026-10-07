import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@plumas/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { requestSignInLink, signInWithPassword } from "../server/functions/sign-in";

export const Route = createFileRoute("/sign-in")({ component: SignIn });

type Status =
  | { kind: "idle" }
  | { kind: "signing-in" }
  | { kind: "sending-link" }
  | { kind: "link-sent" }
  | { kind: "error"; message: string };

function SignIn() {
  const router = useRouter();
  const signIn = useServerFn(signInWithPassword);
  const sendLink = useServerFn(requestSignInLink);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use the password you set when you joined.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setStatus({ kind: "signing-in" });
              void signIn({ data: { email, password } }).then((result) => {
                if (result.ok) {
                  void router.navigate({ to: "/home" });
                } else {
                  setStatus({ kind: "error", message: result.message });
                }
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </div>
            {status.kind === "error" ? (
              <p className="text-sm text-destructive">{status.message}</p>
            ) : null}
            <Button type="submit" disabled={status.kind === "signing-in"}>
              {status.kind === "signing-in" ? "Signing in..." : "Sign in"}
            </Button>
            {status.kind === "link-sent" ? (
              <p className="text-sm text-muted-foreground">
                If that email has an account, a sign-in link is on its way.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={status.kind === "sending-link" || !email}
                onClick={() => {
                  setStatus({ kind: "sending-link" });
                  void sendLink({ data: { email } }).then(() => {
                    setStatus({ kind: "link-sent" });
                  });
                }}
              >
                {status.kind === "sending-link" ? "Sending..." : "Email me a sign-in link instead"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
