import { type Database, schema } from "@plumas/db";
import { sendNotificationEmail } from "@plumas/email";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

const { notifications, users } = schema;

/** Plain JSON, not `unknown` - TanStack Start's server-function serializer requires a type it can verify. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Free-form discriminator (matches the column's own comment in the schema) - this union
 * documents the set FR-NOT-01 actually asks for; the column itself stays plain text so a new
 * type never needs a migration.
 */
export type NotificationType =
  | "comment_on_post"
  | "reply_to_comment"
  | "reaction_on_post"
  | "relationship_request"
  | "group_join_approved"
  | "group_join_declined"
  | "invite_accepted"
  | "comment_on_event"
  | "comment_on_listing"
  | "dm_message"
  | "dm_added_to_group"
  | "event_updated"
  | "event_cancelled";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  payload: Record<string, JsonValue>;
}

function str(payload: Record<string, JsonValue>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * FR-NOT-02: the server-side twin of apps/web's describeNotification/useGoToTarget - same
 * switch, same denormalized payload shape, but producing an email's title/body/path instead of
 * in-app display text/a router navigation. Kept in sync with that client-side pair by hand,
 * same as any other "two sides of one feature" duplication already in this codebase.
 */
function notificationEmailContent(
  type: NotificationType,
  payload: Record<string, JsonValue>,
): { title: string; body: string; path: string } {
  const actor = str(payload, "actorName") ?? "Someone";
  const excerpt = str(payload, "excerpt");
  const targetId = str(payload, "targetId");
  const targetType = str(payload, "targetType");

  function targetPath(): string {
    if (targetType === "event" && targetId) return `/calendar/${targetId}`;
    if (targetType === "listing" && targetId) return `/marketplace/${targetId}`;
    return "/feed";
  }

  switch (type) {
    case "comment_on_post": {
      const title = `${actor} commented on your post`;
      return { title, body: excerpt ?? title, path: "/feed" };
    }
    case "comment_on_event": {
      const title = `${actor} commented on your event`;
      return { title, body: excerpt ?? title, path: targetPath() };
    }
    case "comment_on_listing": {
      const title = `${actor} commented on your listing`;
      return { title, body: excerpt ?? title, path: targetPath() };
    }
    case "reply_to_comment": {
      const title = `${actor} replied to your comment`;
      return { title, body: excerpt ?? title, path: targetPath() };
    }
    case "reaction_on_post": {
      const title = `${actor} reacted to your post`;
      return { title, body: title, path: "/feed" };
    }
    case "relationship_request": {
      const title = `${actor} sent you a relationship request`;
      const actorId = str(payload, "actorId");
      return { title, body: title, path: actorId ? `/profile/${actorId}` : "/feed" };
    }
    case "group_join_approved": {
      const groupName = str(payload, "groupName") ?? "a group";
      const groupSlug = str(payload, "groupSlug");
      return {
        title: `Your request to join ${groupName} was approved`,
        body: `Your request to join ${groupName} was approved`,
        path: groupSlug ? `/groups/${groupSlug}` : "/groups",
      };
    }
    case "group_join_declined": {
      const groupName = str(payload, "groupName") ?? "a group";
      const groupSlug = str(payload, "groupSlug");
      return {
        title: `Your request to join ${groupName} was declined`,
        body: `Your request to join ${groupName} was declined`,
        path: groupSlug ? `/groups/${groupSlug}` : "/groups",
      };
    }
    case "invite_accepted": {
      const newUserName = str(payload, "newUserName") ?? "Someone";
      const newUserId = str(payload, "newUserId");
      const title = `${newUserName} accepted your invite`;
      return { title, body: title, path: newUserId ? `/profile/${newUserId}` : "/feed" };
    }
    case "dm_message": {
      const title = `New message from ${actor}`;
      const conversationId = str(payload, "conversationId");
      return {
        title,
        body: title,
        path: conversationId ? `/messages/${conversationId}` : "/messages",
      };
    }
    case "dm_added_to_group": {
      const groupName = str(payload, "groupName") ?? "a group chat";
      const title = `${actor} added you to ${groupName}`;
      const conversationId = str(payload, "conversationId");
      return {
        title,
        body: title,
        path: conversationId ? `/messages/${conversationId}` : "/messages",
      };
    }
    case "event_updated": {
      const eventTitle = str(payload, "eventTitle") ?? "an event";
      const title = `"${eventTitle}" was updated`;
      return { title, body: title, path: targetPath() };
    }
    case "event_cancelled": {
      const eventTitle = str(payload, "eventTitle") ?? "an event";
      const title = `"${eventTitle}" was cancelled`;
      // Not targetPath() - by the time this email sends, the event row is already gone.
      return { title, body: title, path: "/calendar" };
    }
  }
}

/**
 * Never throws: a notification is a side effect of some other action (posting a comment,
 * reacting, accepting an invite, ...) and a failure here must never roll back or surface as a
 * failure of that primary action. Display data (actor name, an excerpt, target ids) is
 * denormalized into `payload` by the caller at creation time rather than re-joined on read -
 * simpler than the batched-join pattern moderation-service.ts's listOpenReports uses, no N+1,
 * and it keeps reading fine even after the target itself is later deleted.
 */
export async function createNotification(
  database: Database,
  input: CreateNotificationInput,
): Promise<void> {
  try {
    await database
      .insert(notifications)
      .values({ userId: input.userId, type: input.type, payload: input.payload });
  } catch (error) {
    console.error("Failed to create notification", input.type, error);
    return;
  }

  // FR-NOT-02: email, same opt-out default as the schema comment - only an explicit `false`
  // for this type turns it off. A separate try/catch from the insert above: the in-app
  // notification already landed even if this fails, and email failure must never undo that.
  try {
    const [recipient] = await database.select().from(users).where(eq(users.id, input.userId));
    if (!recipient) return;
    const preferences =
      (recipient.notificationEmailPreferences as Partial<
        Record<NotificationType, boolean>
      > | null) ?? {};
    if (preferences[input.type] === false) return;

    const appUrl = process.env.PUBLIC_APP_URL;
    if (!appUrl) return;
    const { title, body, path } = notificationEmailContent(input.type, input.payload);
    await sendNotificationEmail({ to: recipient.email, title, body, url: `${appUrl}${path}` });
  } catch (error) {
    console.error("Failed to send notification email", input.type, error);
  }
}

export interface NotificationItem {
  id: string;
  type: string;
  payload: JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListNotificationsInput {
  userId: string;
  cursor?: string | undefined;
  limit: number;
}

export interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

/** Most recent first, cursor-paginated on createdAt - same shape as listGroups/listEventsInRange. */
export async function listNotificationsForUser(
  database: Database,
  input: ListNotificationsInput,
): Promise<NotificationsPage> {
  const conditions = [eq(notifications.userId, input.userId)];
  if (input.cursor) conditions.push(lt(notifications.createdAt, new Date(input.cursor)));

  const rows = await database
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = page[page.length - 1];

  return {
    // Drizzle infers a jsonb column as `unknown` - the value really is whatever createNotification
    // wrote, always a JsonValue, so this cast just restates what's already true.
    items: page.map((row) => ({ ...row, payload: row.payload as JsonValue })),
    nextCursor: hasMore && lastRow ? lastRow.createdAt.toISOString() : null,
  };
}

export async function countUnreadNotifications(
  database: Database,
  userId: string,
): Promise<number> {
  const rows = await database
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

/** Ownership-checked: silently does nothing for a notification that isn't this user's. */
export async function markNotificationRead(
  database: Database,
  notificationId: string,
  userId: string,
): Promise<void> {
  await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}

export async function markAllNotificationsRead(database: Database, userId: string): Promise<void> {
  await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export type NotificationEmailPreferences = Partial<Record<NotificationType, boolean>>;

/** FR-NOT-02: null (nothing stored yet) reads back as "everything on" - the opt-out default. */
export async function getNotificationEmailPreferences(
  database: Database,
  userId: string,
): Promise<NotificationEmailPreferences> {
  const [row] = await database
    .select({ notificationEmailPreferences: users.notificationEmailPreferences })
    .from(users)
    .where(eq(users.id, userId));
  return (row?.notificationEmailPreferences as NotificationEmailPreferences | null) ?? {};
}

export async function setNotificationEmailPreferences(
  database: Database,
  userId: string,
  preferences: NotificationEmailPreferences,
): Promise<void> {
  await database
    .update(users)
    .set({ notificationEmailPreferences: preferences })
    .where(eq(users.id, userId));
}
