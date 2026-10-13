import {
  countUnreadNotifications,
  getNotificationEmailPreferences,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationEmailPreferences,
} from "@plumas/auth";
import {
  listNotificationsSchema,
  notificationEmailPreferencesSchema,
  notificationIdSchema,
} from "@plumas/validators";
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

export const getNotificationEmailPreferencesFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return getNotificationEmailPreferences(getDb(), user.id);
  },
);

export const setNotificationEmailPreferencesFn = createServerFn({ method: "POST" })
  .validator(notificationEmailPreferencesSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setNotificationEmailPreferences(getDb(), user.id, data);
    return { ok: true as const };
  });
