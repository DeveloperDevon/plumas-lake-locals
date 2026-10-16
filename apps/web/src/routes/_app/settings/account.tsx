import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@plumas/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { exportAllConversations } from "../../../lib/dm-client";
import { deleteOwnAccountFn } from "../../../server/functions/account-deletion";
import { exportAccountDataFn } from "../../../server/functions/export";
import { getHasPassword, setPassword, signOut } from "../../../server/functions/session";

const DELETE_CONFIRMATION_TEXT = "DELETE";

/** Only file-download mechanism in this client (confirmed none existed before this feature) -
 * kept local here since both buttons below are its only two call sites. */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/_app/settings/account")({
  loader: async () => ({ hasPassword: await getHasPassword() }),
  component: Account,
});

function Account() {
  const { hasPassword } = Route.useLoaderData();
  const router = useRouter();

  const doSignOut = useServerFn(signOut);
  const doSetPassword = useServerFn(setPassword);
  const doExportAccountData = useServerFn(exportAccountDataFn);
  const doDeleteOwnAccount = useServerFn(deleteOwnAccountFn);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordState, setPasswordState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  const [exportingAccount, setExportingAccount] = useState(false);
  const [exportingMessages, setExportingMessages] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleExportAccountData() {
    setExportingAccount(true);
    setExportError(null);
    try {
      const data = await doExportAccountData();
      downloadJson(
        `plumas-lake-locals-account-${new Date().toISOString().slice(0, 10)}.json`,
        data,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Couldn't export your data.");
    } finally {
      setExportingAccount(false);
    }
  }

  async function handleExportMessages() {
    setExportingMessages({ done: 0, total: 0 });
    setExportError(null);
    try {
      const data = await exportAllConversations((done, total) => {
        setExportingMessages({ done, total });
      });
      downloadJson(
        `plumas-lake-locals-messages-${new Date().toISOString().slice(0, 10)}.json`,
        data,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Couldn't export your messages.");
    } finally {
      setExportingMessages(null);
    }
  }

  async function refresh() {
    await router.invalidate();
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await doDeleteOwnAccount();
      await doSignOut();
      await router.navigate({ to: "/sign-in" });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Couldn't delete your account.");
      setDeleting(false);
    }
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
          <CardTitle>Download my data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Your profile, posts, comments, groups, events and listings, as a JSON file.
            </p>
            <Button
              variant="outline"
              className="w-fit"
              disabled={exportingAccount}
              onClick={() => void handleExportAccountData()}
            >
              {exportingAccount ? "Preparing..." : "Download account data"}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Your direct message history, decrypted on this device - the server never sees the
              plaintext, so this can take a little while for a lot of history.
            </p>
            <Button
              variant="outline"
              className="w-fit"
              disabled={exportingMessages !== null}
              onClick={() => void handleExportMessages()}
            >
              {exportingMessages
                ? `Decrypting... (${exportingMessages.done.toString()}/${exportingMessages.total.toString()})`
                : "Download message history"}
            </Button>
          </div>
          {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Delete my account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            This permanently closes your account. Your posts and comments are removed; groups or
            business pages you own are handed to another member if one exists. This can&apos;t be
            undone - download your data first if you want to keep a copy.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-confirmation">Type {DELETE_CONFIRMATION_TEXT} to confirm</Label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => {
                setDeleteConfirmation(event.target.value);
              }}
            />
          </div>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <Button
            variant="destructive"
            className="w-fit"
            disabled={deleting || deleteConfirmation !== DELETE_CONFIRMATION_TEXT}
            onClick={() => void handleDeleteAccount()}
          >
            {deleting ? "Deleting..." : "Delete my account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
