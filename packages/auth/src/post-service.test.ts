import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { blockUser } from "./block-service";
import {
  createPost,
  deletePost,
  listFeedPosts,
  listPinnedPosts,
  listPostsByAuthor,
  pinPost,
  PostForbiddenError,
  PostNotFoundError,
  PostPinLimitError,
  removePostReaction,
  setPostReaction,
  unpinPost,
  updatePost,
} from "./post-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("post-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(role), displayName: `Test ${role}`, role })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a post and reads it back in the feed, newest first", async () => {
    const author = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });
    expect(post.body).toBe("Hello neighbors");
    expect(post.category).toBeNull();
    expect(post.pinnedAt).toBeNull();

    const { items } = await listFeedPosts(db, { limit: 20, viewerId: author.id });
    const found = items.find((item) => item.id === post.id);
    expect(found).toMatchObject({
      body: "Hello neighbors",
      authorId: author.id,
      authorDisplayName: author.displayName,
      media: [],
      myReaction: null,
      commentCount: 0,
    });
  });

  it("paginates with a cursor across a page boundary", async () => {
    const author = await makeMember();
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const post = await createPost(db, { authorId: author.id, body: `Post ${i.toString()}` });
      created.push(post.id);
    }

    const firstPage = await listFeedPosts(db, { limit: 2, viewerId: author.id });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    // Newest first - the last-created post should be first.
    expect(firstPage.items[0]?.id).toBe(created[created.length - 1]);

    const secondPage = await listFeedPosts(db, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
      viewerId: author.id,
    });
    expect(secondPage.items).toHaveLength(2);
    const firstPageIds = new Set(firstPage.items.map((item) => item.id));
    for (const item of secondPage.items) {
      expect(firstPageIds.has(item.id)).toBe(false);
    }
  });

  it("only the post's own author can edit or delete it", async () => {
    const author = await makeMember();
    const someoneElse = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Original" });

    await expect(
      updatePost(db, { postId: post.id, authorId: someoneElse.id, body: "Hijacked" }),
    ).rejects.toThrow(PostForbiddenError);
    await expect(deletePost(db, post.id, someoneElse.id)).rejects.toThrow(PostForbiddenError);

    const updated = await updatePost(db, { postId: post.id, authorId: author.id, body: "Edited" });
    expect(updated.body).toBe("Edited");
    expect(updated.editedAt).not.toBeNull();
  });

  it("soft-deletes a post, excluding it from the feed", async () => {
    const author = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Going away" });

    await deletePost(db, post.id, author.id);

    const { items } = await listFeedPosts(db, { limit: 20, viewerId: author.id });
    expect(items.some((item) => item.id === post.id)).toBe(false);

    await expect(deletePost(db, post.id, author.id)).rejects.toThrow(PostNotFoundError);
  });

  it("only an admin can pin or unpin, and pinned posts are excluded from the regular feed", async () => {
    const admin = await makeMember("admin");
    const member = await makeMember();
    const post = await createPost(db, { authorId: member.id, body: "Announcement" });

    await expect(pinPost(db, post.id, member.id)).rejects.toThrow(PostForbiddenError);

    const pinned = await pinPost(db, post.id, admin.id);
    expect(pinned.pinnedAt).not.toBeNull();

    const { items } = await listFeedPosts(db, { limit: 20, viewerId: admin.id });
    expect(items.some((item) => item.id === post.id)).toBe(false);

    const pinnedList = await listPinnedPosts(db, admin.id);
    expect(pinnedList.some((item) => item.id === post.id)).toBe(true);

    await unpinPost(db, post.id, admin.id);
    const { items: itemsAfterUnpin } = await listFeedPosts(db, { limit: 20, viewerId: admin.id });
    expect(itemsAfterUnpin.some((item) => item.id === post.id)).toBe(true);
  });

  it("rejects pinning a 4th post once 3 are already pinned", async () => {
    const admin = await makeMember("admin");
    const [first, second, third, fourth] = await Promise.all(
      Array.from({ length: 4 }, () => createPost(db, { authorId: admin.id, body: "Pin me" })),
    );
    if (!first || !second || !third || !fourth) throw new Error("setup failed");

    await pinPost(db, first.id, admin.id);
    await pinPost(db, second.id, admin.id);
    await pinPost(db, third.id, admin.id);

    await expect(pinPost(db, fourth.id, admin.id)).rejects.toThrow(PostPinLimitError);

    // The cap is global (FR-FEED-07), not per-admin - clean up so later tests in this file
    // start from a clean slate rather than inheriting these 3 pinned posts.
    await unpinPost(db, first.id, admin.id);
    await unpinPost(db, second.id, admin.id);
    await unpinPost(db, third.id, admin.id);
  });

  it("pinning an already-pinned post is idempotent, not an error", async () => {
    const admin = await makeMember("admin");
    const post = await createPost(db, { authorId: admin.id, body: "Pin me twice" });

    await pinPost(db, post.id, admin.id);
    await expect(pinPost(db, post.id, admin.id)).resolves.toMatchObject({ id: post.id });

    await unpinPost(db, post.id, admin.id);
  });

  it("reacting to a post is reflected in counts and the viewer's own reaction, and changing it updates rather than adding", async () => {
    const author = await makeMember();
    const reactor = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "React to this" });

    await setPostReaction(db, post.id, reactor.id, "like");
    const { items: afterLike } = await listFeedPosts(db, { limit: 20, viewerId: reactor.id });
    const likedPost = afterLike.find((item) => item.id === post.id);
    expect(likedPost?.reactionCounts.like).toBe(1);
    expect(likedPost?.myReaction).toBe("like");

    // Changing reaction type is an update, not a new row - the like count drops back to 0.
    await setPostReaction(db, post.id, reactor.id, "love");
    const { items: afterLove } = await listFeedPosts(db, { limit: 20, viewerId: reactor.id });
    const lovedPost = afterLove.find((item) => item.id === post.id);
    expect(lovedPost?.reactionCounts.like).toBe(0);
    expect(lovedPost?.reactionCounts.love).toBe(1);
    expect(lovedPost?.myReaction).toBe("love");

    await removePostReaction(db, post.id, reactor.id);
    const { items: afterRemove } = await listFeedPosts(db, { limit: 20, viewerId: reactor.id });
    const clearedPost = afterRemove.find((item) => item.id === post.id);
    expect(clearedPost?.reactionCounts.love).toBe(0);
    expect(clearedPost?.myReaction).toBeNull();
  });

  it("hides a blocked member's feed posts in both directions (FR-MOD-03)", async () => {
    const alice = await makeMember();
    const bob = await makeMember();
    const alicePost = await createPost(db, { authorId: alice.id, body: "From Alice" });
    const bobPost = await createPost(db, { authorId: bob.id, body: "From Bob" });

    const hasPost = async (viewerId: string, postId: string) =>
      (await listFeedPosts(db, { limit: 50, viewerId })).items.some((item) => item.id === postId);

    expect(await hasPost(bob.id, alicePost.id)).toBe(true);
    expect(await hasPost(alice.id, bobPost.id)).toBe(true);

    await blockUser(db, alice.id, bob.id);

    expect(await hasPost(bob.id, alicePost.id)).toBe(false); // Bob no longer sees Alice's post
    expect(await hasPost(alice.id, bobPost.id)).toBe(false); // nor does Alice see Bob's - both ways
  });

  it("listPostsByAuthor (FR-PRO-06) returns only this author's own feed posts, not another author's or their group/business board posts", async () => {
    const author = await makeMember();
    const someoneElse = await makeMember();
    const feedPost = await createPost(db, { authorId: author.id, body: "My feed post" });
    await createPost(db, {
      authorId: author.id,
      body: "My group post",
      contextType: "group",
      contextId: crypto.randomUUID(),
    });
    await createPost(db, { authorId: someoneElse.id, body: "Someone else's post" });

    const { items } = await listPostsByAuthor(db, {
      authorId: author.id,
      limit: 20,
      viewerId: author.id,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(feedPost.id);
  });

  it("listPostsByAuthor excludes soft-deleted posts and paginates like the feed", async () => {
    const author = await makeMember();
    const deleted = await createPost(db, { authorId: author.id, body: "Will be deleted" });
    await deletePost(db, deleted.id, author.id);
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const post = await createPost(db, { authorId: author.id, body: `Post ${i.toString()}` });
      created.push(post.id);
      // Cursor is millisecond-precision createdAt - a tight loop with a warm connection can
      // otherwise create two rows in the same millisecond and make the cursor boundary ambiguous.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const firstPage = await listPostsByAuthor(db, {
      authorId: author.id,
      limit: 2,
      viewerId: author.id,
    });
    expect(firstPage.items.every((item) => item.id !== deleted.id)).toBe(true);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listPostsByAuthor(db, {
      authorId: author.id,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
      viewerId: author.id,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("listPostsByAuthor respects blocking (FR-MOD-03), both directions", async () => {
    const author = await makeMember();
    const viewer = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Visible until blocked" });

    const before = await listPostsByAuthor(db, {
      authorId: author.id,
      limit: 20,
      viewerId: viewer.id,
    });
    expect(before.items.some((item) => item.id === post.id)).toBe(true);

    await blockUser(db, author.id, viewer.id);

    const after = await listPostsByAuthor(db, {
      authorId: author.id,
      limit: 20,
      viewerId: viewer.id,
    });
    expect(after.items.some((item) => item.id === post.id)).toBe(false);
  });
});
