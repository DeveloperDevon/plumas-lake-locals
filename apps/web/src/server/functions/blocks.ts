import { blockUser, isBlockedEitherWay, listBlockedUsers, unblockUser } from "@plumas/auth";
import { blockUserSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const blockUserFn = createServerFn({ method: "POST" })
  .validator(blockUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await blockUser(getDb(), user.id, data.userId);
    return { ok: true as const };
  });

export const unblockUserFn = createServerFn({ method: "POST" })
  .validator(blockUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await unblockUser(getDb(), user.id, data.userId);
    return { ok: true as const };
  });

export const getMyBlockedUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listBlockedUsers(getDb(), user.id);
});

export const getIsBlockedFn = createServerFn({ method: "GET" })
  .validator(blockUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return isBlockedEitherWay(getDb(), user.id, data.userId);
  });
