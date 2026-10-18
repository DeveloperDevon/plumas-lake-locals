import { getDmClient } from "@plumas/crypto";
import { Button, Card, CardContent } from "@plumas/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  addMemberToGroup,
  type DecryptedMessage,
  decryptMessages,
  finalizePendingDepartures,
  getReadReceipts,
  getTypingUsers,
  leaveGroup,
  markConversationRead,
  type ReadReceipt,
  removeMemberFromGroup,
  searchMembers,
  sendDmMessage,
  setTyping,
  type TypingUser,
  unsendMessage,
} from "../../../lib/dm-client";
import { formatDateTime } from "../../../lib/format-date";
import {
  getConversationSummaryFn,
  getGroupMembersFn,
  getMessagesFn,
} from "../../../server/functions/dm";

// FR-DM-16: mirrors dm-service.ts's UNSEND_WINDOW_MINUTES - a client-side hint only (the server
// is the source of truth and rejects a late attempt regardless).
const UNSEND_WINDOW_MS = 15 * 60 * 1000;

// FR-DM-03: how often an open thread polls for new messages/typing/read receipts. The app
// deploys to Cloudflare Workers via Nitro (no long-running process to hold a websocket) - a
// tight poll is the cheap, infra-free way to approximate "real-time while online".
const POLL_MS = 4000;
// FR-DM-13: client-side throttle so every keystroke doesn't call setTyping - not a server-
// enforced rate limit, just UX politeness (typing rows never touch `messages`, so FR-DM-10's
// budget is untouched either way).
const TYPING_THROTTLE_MS = 2000;

export const Route = createFileRoute("/_app/messages/$conversationId")({
  loader: async ({ params }) => {
    const summary = await getConversationSummaryFn({
      data: { conversationId: params.conversationId },
    });
    const [rows, members] = await Promise.all([
      getMessagesFn({ data: { conversationId: params.conversationId, limit: 100 } }),
      summary.kind === "group"
        ? getGroupMembersFn({ data: { conversationId: params.conversationId } })
        : Promise.resolve(null),
    ]);
    return { summary, rows, members };
  },
  component: ConversationThread,
});

interface GroupMemberRow {
  id: string;
  displayName: string;
  avatarKey: string | null;
}

function ConversationThread() {
  const { conversationId } = Route.useParams();
  const { summary, rows, members: initialMembers } = Route.useLoaderData();
  const navigate = useNavigate();

  const [setUpOnThisDevice, setSetUpOnThisDevice] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGroup = summary.kind === "group";

  const [members, setMembers] = useState<GroupMemberRow[] | null>(initialMembers);
  const [showMembers, setShowMembers] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<GroupMemberRow[]>([]);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [readReceipts, setReadReceipts] = useState<ReadReceipt[]>([]);
  const pollInFlightRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);

  // FR-DM-04: advances the read cursor past the furthest *fetched* row, not just the furthest
  // visible one - see dm-service.ts's countUnreadForUser doc comment for why that matters.
  async function markReadUpTo(fetchedRows: { id: string }[]) {
    const last = fetchedRows[fetchedRows.length - 1];
    if (last) await markConversationRead(conversationId, last.id);
  }

  async function refreshMembers() {
    const fresh = await getGroupMembersFn({ data: { conversationId } });
    setMembers(fresh);
  }

  async function handleMemberSearch(value: string) {
    setMemberQuery(value);
    if (value.trim().length === 0) {
      setMemberResults([]);
      return;
    }
    const found = await searchMembers(value);
    setMemberResults(found);
  }

  async function handleAddMember(userId: string) {
    setMemberBusyId(userId);
    setMemberError(null);
    try {
      await addMemberToGroup(conversationId, userId);
      setMemberQuery("");
      setMemberResults([]);
      await refreshMembers();
    } catch (addError) {
      setMemberError(addError instanceof Error ? addError.message : "Couldn't add that member.");
    } finally {
      setMemberBusyId(null);
    }
  }

  async function handleRemoveMember(userId: string) {
    setMemberBusyId(userId);
    setMemberError(null);
    try {
      await removeMemberFromGroup(conversationId, userId);
      await refreshMembers();
    } catch (removeError) {
      setMemberError(
        removeError instanceof Error ? removeError.message : "Couldn't remove that member.",
      );
    } finally {
      setMemberBusyId(null);
    }
  }

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
    (async () => {
      // Best-effort: finalize anyone who's left before decrypting, so their messages (if any
      // arrive later) are never attempted against a stale tree. A no-op for direct
      // conversations, which never have pending departures.
      await finalizePendingDepartures(conversationId);
      const decrypted = await decryptMessages(conversationId, rows);
      // False positive: the checker can't see that the effect's cleanup (below) reassigns
      // `cancelled` from a later run/unmount, which is exactly the race this guards against.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) return;
      setMessages(decrypted);
      const last = rows[rows.length - 1];
      if (last) await markConversationRead(conversationId, last.id);
    })().catch((decryptError: unknown) => {
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

  // FR-DM-03/FR-DM-13: polls the open thread for new messages, typing, and read receipts. Skips
  // a tick while the previous one is still in flight or the tab isn't visible, same reasoning as
  // the 30s nav-badge poll in _app.tsx, just tighter and scoped to this one thread.
  useEffect(() => {
    if (!setUpOnThisDevice) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (pollInFlightRef.current || document.visibilityState !== "visible") return;
      pollInFlightRef.current = true;
      void (async () => {
        const freshRows = await getMessagesFn({ data: { conversationId, limit: 100 } });
        const decrypted = await decryptMessages(conversationId, freshRows);
        if (cancelled) return;
        setMessages(decrypted);
        const last = freshRows[freshRows.length - 1];
        if (last) await markConversationRead(conversationId, last.id);
        const [typing, receipts] = await Promise.all([
          getTypingUsers(conversationId),
          getReadReceipts(conversationId),
        ]);
        // False positive: the checker can't see that the effect's cleanup (below) reassigns
        // `cancelled` from a later run/unmount, which is exactly the race this guards against.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) return;
        setTypingUsers(typing);
        setReadReceipts(receipts);
      })()
        .catch(() => undefined) // a transient poll failure just retries on the next tick
        .finally(() => {
          pollInFlightRef.current = false;
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setUpOnThisDevice, conversationId]);

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

  function handleDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAtRef.current = now;
    void setTyping(conversationId).catch(() => undefined);
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
      await markReadUpTo(freshRows);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Couldn't send that message.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsend(messageId: string) {
    setError(null);
    try {
      await unsendMessage(messageId);
      await handleRefresh();
    } catch (unsendError) {
      setError(
        unsendError instanceof Error ? unsendError.message : "Couldn't unsend that message.",
      );
    }
  }

  async function handleRefresh() {
    setError(null);
    try {
      const freshRows = await getMessagesFn({ data: { conversationId, limit: 100 } });
      const decrypted = await decryptMessages(conversationId, freshRows);
      setMessages(decrypted);
      await markReadUpTo(freshRows);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Couldn't refresh this conversation.",
      );
    }
  }

  async function handleLeave() {
    setLeaving(true);
    setError(null);
    try {
      await leaveGroup(conversationId);
      await navigate({ to: "/messages" });
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "Couldn't leave this group.");
      setLeaving(false);
    }
  }

  // FR-DM-13: read receipt for my own most recent (non-unsent) message only - no per-message,
  // no per-person breakdown. message.id is a UUIDv7, so plain string comparison against each
  // participant's lastReadMessageId sorts chronologically, the same trick markConversationRead/
  // countUnreadForUser already rely on server-side.
  const myLastMessageId =
    [...(messages ?? [])].reverse().find((message) => message.mine && !message.unsentAt)?.id ??
    null;
  const readLabel =
    myLastMessageId !== null &&
    readReceipts.length > 0 &&
    readReceipts.every(
      (receipt) =>
        receipt.lastReadMessageId !== null && receipt.lastReadMessageId >= myLastMessageId,
    )
      ? isGroup
        ? "Read by all"
        : "Read"
      : null;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-semibold">{summary.displayName}</h2>
          {isGroup && summary.memberCount !== null ? (
            <p className="text-xs text-muted-foreground">{summary.memberCount} members</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {isGroup ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowMembers((shown) => !shown);
              }}
            >
              Members
            </Button>
          ) : null}
          {isGroup ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={leaving}
              onClick={() => void handleLeave()}
            >
              Leave group
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void handleRefresh()}>
            Refresh
          </Button>
        </div>
      </div>

      {isGroup && showMembers ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-col gap-1">
            {(members ?? []).map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-2">
                <span>{member.displayName}</span>
                {summary.isCreator ? (
                  <button
                    type="button"
                    disabled={memberBusyId === member.id}
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => void handleRemoveMember(member.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {(members ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No active members.</p>
            ) : null}
          </div>

          {summary.isCreator ? (
            <div className="relative flex flex-col gap-1 border-t border-border pt-3">
              <label htmlFor="add-member-search" className="text-xs font-medium">
                Add a member
              </label>
              <input
                id="add-member-search"
                type="text"
                value={memberQuery}
                placeholder="Search members by name..."
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                onChange={(event) => {
                  void handleMemberSearch(event.target.value);
                }}
              />
              {memberResults.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-1">
                  {memberResults
                    .filter((result) => !(members ?? []).some((member) => member.id === result.id))
                    .map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        disabled={memberBusyId === result.id}
                        className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => void handleAddMember(result.id)}
                      >
                        {result.displayName}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {memberError ? <p className="text-xs text-destructive">{memberError}</p> : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {messages === null ? (
          <p className="text-sm text-muted-foreground">Decrypting...</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages
              .filter((message) => message.plaintext !== null || message.unsentAt !== null)
              .map((message) => {
                const canUnsend =
                  message.mine &&
                  !message.unsentAt &&
                  Date.now() - message.createdAt.getTime() <= UNSEND_WINDOW_MS;
                return (
                  <div
                    key={message.id}
                    className={`flex flex-col ${message.mine ? "items-end" : "items-start"}`}
                  >
                    {isGroup && !message.mine ? (
                      <span className="mb-0.5 text-xs font-medium text-muted-foreground">
                        {message.senderDisplayName}
                      </span>
                    ) : null}
                    <div
                      className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                        message.unsentAt
                          ? "italic text-muted-foreground"
                          : message.mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                      }`}
                    >
                      {message.unsentAt ? "Message unsent" : message.plaintext}
                    </div>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {formatDateTime(message.createdAt)}
                      {canUnsend ? (
                        <button
                          type="button"
                          className="hover:text-foreground hover:underline"
                          onClick={() => void handleUnsend(message.id)}
                        >
                          Unsend
                        </button>
                      ) : null}
                      {message.id === myLastMessageId && readLabel ? (
                        <span>{readLabel}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {typingUsers.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {typingUsers.map((user) => user.displayName).join(", ")}{" "}
          {typingUsers.length === 1 ? "is" : "are"} typing...
        </p>
      ) : null}

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
            handleDraftChange(event.target.value);
          }}
        />
        <Button type="submit" disabled={busy || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
