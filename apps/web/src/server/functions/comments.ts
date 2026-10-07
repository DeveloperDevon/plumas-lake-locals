import {
  createComment,
  deleteComment,
  listCommentsForPost,
  removePostReaction,
  setPostReaction,
  updateComment,
} from "@plumas/auth";
import {
  createCommentSchema,
  removeReactionSchema,
  setReactionSchema,
  updateCommentSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getComments = createServerFn({ method: "GET" })
  .validator(z.object({ postId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listCommentsForPost(getDb(), data.postId);
  });

export const createCommentFn = createServerFn({ method: "POST" })
  .validator(createCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createComment(getDb(), { ...data, userId: user.id });
  });

export const updateCommentFn = createServerFn({ method: "POST" })
  .validator(updateCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateComment(getDb(), { ...data, userId: user.id });
  });

export const deleteCommentFn = createServerFn({ method: "POST" })
  .validator(z.object({ commentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteComment(getDb(), data.commentId, user.id);
    return { ok: true as const };
  });

export const setReactionFn = createServerFn({ method: "POST" })
  .validator(setReactionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setPostReaction(getDb(), data.postId, user.id, data.type);
    return { ok: true as const };
  });

export const removeReactionFn = createServerFn({ method: "POST" })
  .validator(removeReactionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removePostReaction(getDb(), data.postId, user.id);
    return { ok: true as const };
  });
