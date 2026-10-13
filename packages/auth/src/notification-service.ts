import { type Database, schema } from "@plumas/db";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

const { notifications } = schema;

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
  | "dm_added_to_group";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  payload: Record<string, JsonValue>;
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
