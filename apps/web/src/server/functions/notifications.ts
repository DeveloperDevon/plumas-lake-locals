import {
  countUnreadNotifications,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from "@plumas/auth";
import { listNotificationsSchema, notificationIdSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getNotificationsFn = createServerFn({ method: "GET" })
  .validator(listNotificationsSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listNotificationsForUser(getDb(), { userId: user.id, ...data });
  });

export const getUnreadNotificationCountFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return countUnreadNotifications(getDb(), user.id);
});

export const markNotificationReadFn = createServerFn({ method: "POST" })
  .validator(notificationIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await markNotificationRead(getDb(), data.notificationId, user.id);
  });

export const markAllNotificationsReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  await markAllNotificationsRead(getDb(), user.id);
});
