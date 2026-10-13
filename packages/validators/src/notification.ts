import { z } from "zod";

import { cursorPaginationSchema, uuidSchema } from "./common";

export const listNotificationsSchema = cursorPaginationSchema;
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const notificationIdSchema = z.object({ notificationId: uuidSchema });

/** Mirrors packages/auth's NotificationType - same list, two sides of one feature, kept in sync by hand. */
export const notificationTypes = [
  "comment_on_post",
  "reply_to_comment",
  "reaction_on_post",
  "relationship_request",
  "group_join_approved",
  "group_join_declined",
  "invite_accepted",
  "comment_on_event",
  "comment_on_listing",
  "dm_message",
  "dm_added_to_group",
  "event_updated",
  "event_cancelled",
] as const;
export type NotificationType = (typeof notificationTypes)[number];

/** FR-NOT-02: per-type opt-out - a present key set to `false` turns that type's email off. */
export const notificationEmailPreferencesSchema = z.record(z.enum(notificationTypes), z.boolean());
export type NotificationEmailPreferencesInput = z.infer<typeof notificationEmailPreferencesSchema>;
