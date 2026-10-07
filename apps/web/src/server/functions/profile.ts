import { getProfile, updateProfile } from "@plumas/auth";
import { userProfileSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getProfileById = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    return getProfile(getDb(), data.userId, viewer.id);
  });

/** Writes only the caller's own row (requireUser) - never a client-supplied id. */
export const updateMyProfile = createServerFn({ method: "POST" })
  .validator(userProfileSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await updateProfile(getDb(), user.id, data);
    return { ok: true as const };
  });
