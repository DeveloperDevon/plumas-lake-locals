import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@plumas/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  getMyInvites,
  resendMyInvite,
  revokeMyInvite,
  sendInvite,
} from "../../server/functions/invites-admin";
import { signOut } from "../../server/functions/session";

export const Route = createFileRoute("/_app/home")({
  loader: async () => ({ invites: await getMyInvites() }),
  component: Home,
});

function inviteStatus(invite: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() < Date.now()) return "expired";
  return "pending";
}

function Home() {
  const { user } = Route.useRouteContext();
  const { invites } = Route.useLoaderData();
  const router = useRouter();

  const doSignOut = useServerFn(signOut);
  const doSendInvite = useServerFn(sendInvite);
  const doRevoke = useServerFn(revokeMyInvite);
  const doResend = useServerFn(resendMyInvite);

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function refresh() {
    await router.invalidate();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
        <Button
          variant="outline"
          onClick={() => {
            void doSignOut().then(() => router.navigate({ to: "/sign-in" }));
          }}
        >
          Sign out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite a neighbor</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setSending(true);
              void doSendInvite({ data: { email, note: note || undefined } })
                .then(() => {
                  setEmail("");
                  setNote("");
                  return refresh();
                })
                .finally(() => {
                  setSending(false);
                });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-note">Note (optional)</Label>
              <Input
                id="invite-note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send invite"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No invites sent yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {invites.map((invite) => {
                const status = inviteStatus(invite);
                return (
                  <li key={invite.id} className="flex items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium">{invite.email}</p>
                      <p className="text-slate-500">{status}</p>
                    </div>
                    {status === "pending" ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void doResend({ data: { inviteId: invite.id } }).then(refresh);
                          }}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void doRevoke({ data: { inviteId: invite.id } }).then(refresh);
                          }}
                        >
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
