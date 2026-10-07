import {
  createPost,
  deletePost,
  listFeedPosts,
  listPinnedPosts,
  pinPost,
  unpinPost,
  updatePost,
} from "@plumas/auth";
import { createPostSchema, cursorPaginationSchema, updatePostSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getFeed = createServerFn({ method: "GET" })
  .validator(cursorPaginationSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getDb();
    const [page, pinned] = await Promise.all([
      listFeedPosts(db, { cursor: data.cursor, limit: data.limit, viewerId: user.id }),
      data.cursor ? Promise.resolve([]) : listPinnedPosts(db, user.id),
    ]);
    return { ...page, pinned };
  });

export const createPostFn = createServerFn({ method: "POST" })
  .validator(createPostSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createPost(getDb(), { authorId: user.id, body: data.body, category: data.category });
  });

export const updatePostFn = createServerFn({ method: "POST" })
  .validator(updatePostSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updatePost(getDb(), { ...data, authorId: user.id });
  });

export const deletePostFn = createServerFn({ method: "POST" })
  .validator(z.object({ postId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deletePost(getDb(), data.postId, user.id);
    return { ok: true as const };
  });

export const pinPostFn = createServerFn({ method: "POST" })
  .validator(z.object({ postId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return pinPost(getDb(), data.postId, user.id);
  });

export const unpinPostFn = createServerFn({ method: "POST" })
  .validator(z.object({ postId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return unpinPost(getDb(), data.postId, user.id);
  });
