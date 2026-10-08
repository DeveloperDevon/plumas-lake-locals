import { getDmClient } from "@plumas/crypto";
import { Button, Card, CardContent } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { type DecryptedMessage, decryptMessages, sendDmMessage } from "../../../lib/dm-client";
import { formatDateTime } from "../../../lib/format-date";
import { getConversationSummaryFn, getMessagesFn } from "../../../server/functions/dm";

export const Route = createFileRoute("/_app/messages/$conversationId")({
  loader: async ({ params }) => {
    const [summary, rows] = await Promise.all([
      getConversationSummaryFn({ data: { conversationId: params.conversationId } }),
      getMessagesFn({ data: { conversationId: params.conversationId, limit: 100 } }),
    ]);
    return { summary, rows };
  },
  component: ConversationThread,
});

function ConversationThread() {
  const { conversationId } = Route.useParams();
  const { summary, rows } = Route.useLoaderData();

  const [setUpOnThisDevice, setSetUpOnThisDevice] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getDmClient()
      .getConfirmedDeviceId()
      .then((deviceId) => {
        if (cancelled) return;
        setSetUpOnThisDevice(Boolean(deviceId));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!setUpOnThisDevice) return;
    let cancelled = false;
    decryptMessages(conversationId, rows)
      .then((decrypted) => {
        if (!cancelled) setMessages(decrypted);
      })
      .catch((decryptError: unknown) => {
        if (cancelled) return;
        setError(
          decryptError instanceof Error
            ? decryptError.message
            : "Couldn't decrypt this conversation.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [setUpOnThisDevice, conversationId, rows]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (setUpOnThisDevice === false) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          <p>You need to set up messaging on this device before you can read conversations.</p>
          <Link to="/settings/messaging" className="font-medium text-primary hover:underline">
            Set up messaging
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await sendDmMessage(conversationId, text);
      setDraft("");
      const freshRows = await getMessagesFn({ data: { conversationId, limit: 100 } });
      const decrypted = await decryptMessages(conversationId, freshRows);
      setMessages(decrypted);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Couldn't send that message.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setError(null);
    try {
      const freshRows = await getMessagesFn({ data: { conversationId, limit: 100 } });
      const decrypted = await decryptMessages(conversationId, freshRows);
      setMessages(decrypted);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Couldn't refresh this conversation.",
      );
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="text-lg font-semibold">{summary.otherDisplayName}</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => void handleRefresh()}>
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages === null ? (
          <p className="text-sm text-muted-foreground">Decrypting...</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages
              .filter((message) => message.plaintext !== null)
              .map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col ${message.mine ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                      message.mine ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    {message.plaintext}
                  </div>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(message.createdAt)}
                  </span>
                </div>
              ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <form
        className="flex gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={2000}
          placeholder="Write a message..."
          className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" disabled={busy || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
