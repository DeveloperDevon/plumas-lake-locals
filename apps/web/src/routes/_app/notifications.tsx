import { Button, Card, CardContent } from "@plumas/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { useState } from "react";

import { formatDateTime } from "../../lib/format-date";
import {
  getNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
} from "../../server/functions/notifications";

export const Route = createFileRoute("/_app/notifications")({
  loader: async () => getNotificationsFn({ data: { limit: 30 } }),
  component: Notifications,
});

interface NotificationRow {
  id: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

function payloadOf(row: NotificationRow): Record<string, unknown> {
  return (row.payload as Record<string, unknown> | null) ?? {};
}
function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/** One line of display text per notification type - every type's payload was denormalized at creation time, so this never re-fetches anything. */
function describeNotification(row: NotificationRow): string {
  const p = payloadOf(row);
  const actor = str(p, "actorName") ?? "Someone";
  switch (row.type) {
    case "comment_on_post":
      return `${actor} commented on your post`;
    case "comment_on_event":
      return `${actor} commented on your event`;
    case "reply_to_comment":
      return `${actor} replied to your comment`;
    case "reaction_on_post":
      return `${actor} reacted to your post`;
    case "relationship_request":
      return `${actor} sent you a relationship request`;
    case "group_join_approved":
      return `Your request to join ${str(p, "groupName") ?? "a group"} was approved`;
    case "group_join_declined":
      return `Your request to join ${str(p, "groupName") ?? "a group"} was declined`;
    case "invite_accepted":
      return `${str(p, "newUserName") ?? "Someone"} accepted your invite`;
    case "dm_message":
      return `New message from ${actor}`;
    case "dm_added_to_group":
      return `${actor} added you to ${str(p, "groupName") ?? "a group chat"}`;
    default:
      return "New notification";
  }
}

/** Where "View" navigates - a switch over literal routes, since TanStack's typed Link can't take a dynamic `to`. */
function useGoToTarget() {
  const navigate = useNavigate();
  return async (row: NotificationRow) => {
    const p = payloadOf(row);
    switch (row.type) {
      case "comment_on_event":
      case "reply_to_comment": {
        if (str(p, "targetType") === "event") {
          const eventId = str(p, "targetId");
          if (eventId) {
            await navigate({ to: "/calendar/$eventId", params: { eventId } });
            return;
          }
        }
        await navigate({ to: "/feed" });
        return;
      }
      case "comment_on_post":
      case "reaction_on_post":
        await navigate({ to: "/feed" });
        return;
      case "relationship_request": {
        const actorId = str(p, "actorId");
        if (actorId) await navigate({ to: "/profile/$userId", params: { userId: actorId } });
        return;
      }
      case "group_join_approved":
      case "group_join_declined": {
        const slug = str(p, "groupSlug");
        if (slug) await navigate({ to: "/groups/$slug", params: { slug } });
        else await navigate({ to: "/groups" });
        return;
      }
      case "invite_accepted": {
        const newUserId = str(p, "newUserId");
        if (newUserId) await navigate({ to: "/profile/$userId", params: { userId: newUserId } });
        return;
      }
      case "dm_message":
      case "dm_added_to_group": {
        const conversationId = str(p, "conversationId");
        if (conversationId) {
          await navigate({ to: "/messages/$conversationId", params: { conversationId } });
        } else {
          await navigate({ to: "/messages" });
        }
        return;
      }
      default:
        return;
    }
  };
}

function Notifications() {
  const initial = Route.useLoaderData();
  const doMarkRead = useServerFn(markNotificationReadFn);
  const doMarkAllRead = useServerFn(markAllNotificationsReadFn);
  const goToTarget = useGoToTarget();

  const [items, setItems] = useState<NotificationRow[]>(initial.items);
  const [markingAll, setMarkingAll] = useState(false);

  async function handleOpen(row: NotificationRow) {
    if (!row.readAt) {
      setItems((previous) =>
        previous.map((item) => (item.id === row.id ? { ...item, readAt: new Date() } : item)),
      );
      await doMarkRead({ data: { notificationId: row.id } });
    }
    await goToTarget(row);
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    setItems((previous) =>
      previous.map((item) => ({ ...item, readAt: item.readAt ?? new Date() })),
    );
    await doMarkAllRead();
    setMarkingAll(false);
  }

  const hasUnread = items.some((item) => !item.readAt);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasUnread || markingAll}
          onClick={() => void handleMarkAllRead()}
        >
          Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Bell className="h-8 w-8" />
          <p className="text-sm">No notifications yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="p-0">
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 rounded-md p-4 text-left hover:bg-muted ${
                      row.readAt ? "" : "bg-primary/5"
                    }`}
                    onClick={() => void handleOpen(row)}
                  >
                    <p className="text-sm">{describeNotification(row)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
                  </button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
