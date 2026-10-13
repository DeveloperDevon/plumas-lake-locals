import { type Database, schema } from "@plumas/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { createNotification } from "./notification-service";

const { comments, posts, users } = schema;

export class CommentNotFoundError extends Error {
  constructor(message = "That comment no longer exists.") {
    super(message);
  }
}

export class CommentForbiddenError extends Error {
  constructor(message = "You can't do that to this comment.") {
    super(message);
  }
}

export class CommentReplyDepthError extends Error {
  constructor() {
    super("Replies can only be one level deep.");
  }
}

export interface CommentItem {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
}

/** FR-FEED-05: all comments for a post, including soft-deleted ones - a reply thread must not orphan when its parent is deleted; the UI renders a deleted row as a muted placeholder instead of hiding it. */
export async function listCommentsForPost(
  database: Database,
  postId: string,
): Promise<CommentItem[]> {
  const rows = await database
    .select({
      id: comments.id,
      body: comments.body,
      parentId: comments.parentId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      authorId: comments.userId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.targetType, "post"), eq(comments.targetId, postId)))
    .orderBy(asc(comments.createdAt));
  return rows;
}

/** Bulk non-deleted comment count per post, for feed cards - one query, grouped in JS, never N+1. */
export async function countCommentsForPosts(
  database: Database,
  postIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;

  const rows = await database
    .select({ targetId: comments.targetId })
    .from(comments)
    .where(
      and(
        eq(comments.targetType, "post"),
        inArray(comments.targetId, [...postIds]),
        isNull(comments.deletedAt),
      ),
    );

  for (const row of rows) {
    map.set(row.targetId, (map.get(row.targetId) ?? 0) + 1);
  }
  return map;
}

export interface CreateCommentInput {
  postId: string;
  userId: string;
  body: string;
  parentId?: string | undefined;
}

export async function createComment(database: Database, input: CreateCommentInput) {
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const [parent] = await database.select().from(comments).where(eq(comments.id, input.parentId));
    if (parent?.targetType !== "post" || parent.targetId !== input.postId || parent.deletedAt) {
      throw new CommentNotFoundError("The comment you're replying to no longer exists.");
    }
    // One level of replies (FR-FEED-03): a reply's parent must itself be top-level.
    if (parent.parentId) throw new CommentReplyDepthError();
    parentAuthorId = parent.userId;
  }

  const [row] = await database
    .insert(comments)
    .values({
      targetType: "post",
      targetId: input.postId,
      userId: input.userId,
      parentId: input.parentId ?? null,
      body: input.body,
    })
    .returning();
  if (!row) throw new Error("Failed to create comment");

  const [post] = await database
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, input.postId));

  await notifyAboutComment(database, {
    targetType: "post",
    targetId: input.postId,
    ownerId: post?.authorId ?? null,
    commenterId: input.userId,
    parentAuthorId,
    body: input.body,
  });

  return row;
}

/**
 * FR-NOT-01: notifies the post/event owner ("comment_on_post"/"comment_on_event") and, for a
 * reply, separately the parent comment's author ("reply_to_comment") - skipping whichever
 * recipient is the commenter themselves. Shared by createComment and event-service.ts's
 * createEventComment, both resolving their own owner id (posts and events are different
 * tables) and calling into this for the shared notify shape.
 */
export async function notifyAboutComment(
  database: Database,
  input: {
    targetType: "post" | "event" | "listing";
    targetId: string;
    ownerId: string | null;
    commenterId: string;
    parentAuthorId: string | null;
    body: string;
  },
): Promise<void> {
  const [commenter] = await database
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.commenterId));
  const actorName = commenter?.displayName ?? "A member";
  const excerpt = input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body;
  const ownerId = input.ownerId;

  if (ownerId && ownerId !== input.commenterId) {
    await createNotification(database, {
      userId: ownerId,
      type:
        input.targetType === "post"
          ? "comment_on_post"
          : input.targetType === "event"
            ? "comment_on_event"
            : "comment_on_listing",
      payload: {
        actorId: input.commenterId,
        actorName,
        targetType: input.targetType,
        targetId: input.targetId,
        excerpt,
      },
    });
  }
  if (
    input.parentAuthorId &&
    input.parentAuthorId !== input.commenterId &&
    input.parentAuthorId !== ownerId
  ) {
    await createNotification(database, {
      userId: input.parentAuthorId,
      type: "reply_to_comment",
      payload: {
        actorId: input.commenterId,
        actorName,
        targetType: input.targetType,
        targetId: input.targetId,
        excerpt,
      },
    });
  }
}

export interface UpdateCommentInput {
  commentId: string;
  userId: string;
  body: string;
}

/** Only the comment's own author may edit it - enforced here, not just the client hiding the button. */
export async function updateComment(database: Database, input: UpdateCommentInput) {
  const [existing] = await database.select().from(comments).where(eq(comments.id, input.commentId));
  if (!existing || existing.deletedAt) throw new CommentNotFoundError();
  if (existing.userId !== input.userId) throw new CommentForbiddenError();

  const [row] = await database
    .update(comments)
    .set({ body: input.body, editedAt: new Date() })
    .where(eq(comments.id, input.commentId))
    .returning();
  if (!row) throw new Error("Failed to update comment");
  return row;
}

/** Only the comment's own author may delete it. Soft delete - the row stays so replies never orphan. */
export async function deleteComment(database: Database, commentId: string, userId: string) {
  const [existing] = await database.select().from(comments).where(eq(comments.id, commentId));
  if (!existing || existing.deletedAt) throw new CommentNotFoundError();
  if (existing.userId !== userId) throw new CommentForbiddenError();

  await database.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
}
