import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { CircleUserRound, Users } from "lucide-react";

import { getMyConversationsFn } from "../../server/functions/dm";

export const Route = createFileRoute("/_app/messages")({
  loader: async () => getMyConversationsFn(),
  component: MessagesLayout,
});

function MessagesLayout() {
  const conversations = Route.useLoaderData();

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
          conversations.map((conversation) => (
            <Link
              key={conversation.id}
              to="/messages/$conversationId"
              params={{ conversationId: conversation.id }}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
              activeProps={{ className: "bg-muted" }}
            >
              {conversation.kind === "group" ? (
                <Users className="h-8 w-8 shrink-0 text-muted-foreground" />
              ) : (
                <CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate font-medium">{conversation.displayName}</span>
            </Link>
          ))
        )}
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </main>
  );
}
