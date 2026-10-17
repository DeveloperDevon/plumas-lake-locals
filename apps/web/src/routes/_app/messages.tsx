import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { CircleUserRound, Users, X } from "lucide-react";
import { useState } from "react";

import { hideConversation } from "../../lib/dm-client";
import { getMyConversationsFn, getUnreadMessageCountsFn } from "../../server/functions/dm";

export const Route = createFileRoute("/_app/messages")({
  loader: async () => {
    const [conversations, unread] = await Promise.all([
      getMyConversationsFn(),
      getUnreadMessageCountsFn(),
    ]);
    return { conversations, unread };
  },
  component: MessagesLayout,
});

function MessagesLayout() {
  const initial = Route.useLoaderData();

  const [conversations, setConversations] = useState(initial.conversations);
  const [unreadByConversation, setUnreadByConversation] = useState(initial.unread.byConversation);

  async function handleDelete(conversationId: string) {
    setConversations((previous) => previous.filter((row) => row.id !== conversationId));
    await hideConversation(conversationId);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl gap-6 p-6">
      <aside className="flex w-64 shrink-0 flex-col gap-1">
        <div className="mb-2 flex items-center justify-between px-2">
          <h1 className="text-xl font-semibold">Messages</h1>
          <Link to="/messages/new" className="text-sm font-medium text-primary hover:underline">
            New group
          </Link>
        </div>
        {conversations.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          conversations.map((conversation) => {
            const unread = unreadByConversation[conversation.id] ?? 0;
            return (
              <div key={conversation.id} className="group flex items-center gap-1">
                <Link
                  to="/messages/$conversationId"
                  params={{ conversationId: conversation.id }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                  activeProps={{ className: "bg-muted" }}
                  onClick={() => {
                    // Optimistic - the thread view itself marks the server-side cursor read
                    // once it finishes decrypting (see $conversationId.tsx's markReadUpTo).
                    setUnreadByConversation((previous) => ({
                      ...previous,
                      [conversation.id]: 0,
                    }));
                  }}
                >
                  {conversation.kind === "group" ? (
                    <Users className="h-8 w-8 shrink-0 text-muted-foreground" />
                  ) : (
                    <CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {conversation.displayName}
                  </span>
                  {unread > 0 ? (
                    <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100"
                  onClick={() => void handleDelete(conversation.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </main>
  );
}
