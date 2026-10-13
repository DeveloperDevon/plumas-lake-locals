import { z } from "zod";

import { cursorPaginationSchema, uuidSchema } from "./common";

export const listNotificationsSchema = cursorPaginationSchema;
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const notificationIdSchema = z.object({ notificationId: uuidSchema });
