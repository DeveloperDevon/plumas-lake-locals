import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentReplyDepthError,
  createComment,
  deleteComment,
  listCommentsForPost,
  updateComment,
} from "./comment-service";
import { createPost } from "./post-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("comment-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember() {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("member"), displayName: "Test member", role: "member" })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a top-level comment and reads it back", async () => {
    const author = await makeMember();
    const commenter = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });

    const comment = await createComment(db, {
      postId: post.id,
      userId: commenter.id,
      body: "Nice post",
    });
    expect(comment.parentId).toBeNull();
    expect(comment.editedAt).toBeNull();

    const comments = await listCommentsForPost(db, post.id);
    expect(comments.some((c) => c.id === comment.id && c.body === "Nice post")).toBe(true);
  });

  it("allows a reply to a top-level comment, but not a reply to a reply", async () => {
    const author = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });

    const topLevel = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Top level",
    });
    const reply = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "A reply",
      parentId: topLevel.id,
    });
    expect(reply.parentId).toBe(topLevel.id);

    await expect(
      createComment(db, {
        postId: post.id,
        userId: author.id,
        body: "A reply to a reply",
        parentId: reply.id,
      }),
    ).rejects.toThrow(CommentReplyDepthError);
  });

  it("rejects a reply to an already-deleted parent comment", async () => {
    const author = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });
    const parent = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Parent",
    });
    await deleteComment(db, parent.id, author.id);

    await expect(
      createComment(db, {
        postId: post.id,
        userId: author.id,
        body: "Too late",
        parentId: parent.id,
      }),
    ).rejects.toThrow(CommentNotFoundError);
  });

  it("rejects a parentId belonging to a different post", async () => {
    const author = await makeMember();
    const postA = await createPost(db, { authorId: author.id, body: "Post A" });
    const postB = await createPost(db, { authorId: author.id, body: "Post B" });
    const commentOnA = await createComment(db, {
      postId: postA.id,
      userId: author.id,
      body: "On A",
    });

    await expect(
      createComment(db, {
        postId: postB.id,
        userId: author.id,
        body: "Mismatched reply",
        parentId: commentOnA.id,
      }),
    ).rejects.toThrow(CommentNotFoundError);
  });

  it("only the comment's own author can edit or delete it", async () => {
    const author = await makeMember();
    const someoneElse = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });
    const comment = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Original",
    });

    await expect(
      updateComment(db, { commentId: comment.id, userId: someoneElse.id, body: "Hijacked" }),
    ).rejects.toThrow(CommentForbiddenError);
    await expect(deleteComment(db, comment.id, someoneElse.id)).rejects.toThrow(
      CommentForbiddenError,
    );

    const updated = await updateComment(db, {
      commentId: comment.id,
      userId: author.id,
      body: "Edited",
    });
    expect(updated.body).toBe("Edited");
    expect(updated.editedAt).not.toBeNull();
  });

  it("soft-deleting a parent comment keeps its reply visible in the thread", async () => {
    const author = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });
    const parent = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Parent",
    });
    const reply = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Reply",
      parentId: parent.id,
    });

    await deleteComment(db, parent.id, author.id);

    const comments = await listCommentsForPost(db, post.id);
    const parentRow = comments.find((c) => c.id === parent.id);
    const replyRow = comments.find((c) => c.id === reply.id);
    expect(parentRow?.deletedAt).not.toBeNull();
    expect(replyRow).toBeDefined();
    expect(replyRow?.deletedAt).toBeNull();
    expect(replyRow?.parentId).toBe(parent.id);

    await expect(deleteComment(db, parent.id, author.id)).rejects.toThrow(CommentNotFoundError);
  });
});
