import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import {
  createPost,
  deletePost,
  listFeedPosts,
  listPinnedPosts,
  pinPost,
  PostForbiddenError,
  PostNotFoundError,
  PostPinLimitError,
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

    const { items } = await listFeedPosts(db, { limit: 20 });
    const found = items.find((item) => item.id === post.id);
    expect(found).toMatchObject({
      body: "Hello neighbors",
      authorId: author.id,
      authorDisplayName: author.displayName,
      media: [],
    });
  });

  it("paginates with a cursor across a page boundary", async () => {
    const author = await makeMember();
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const post = await createPost(db, { authorId: author.id, body: `Post ${i.toString()}` });
      created.push(post.id);
    }

    const firstPage = await listFeedPosts(db, { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    // Newest first - the last-created post should be first.
    expect(firstPage.items[0]?.id).toBe(created[created.length - 1]);

    const secondPage = await listFeedPosts(db, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
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

    const { items } = await listFeedPosts(db, { limit: 20 });
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

    const { items } = await listFeedPosts(db, { limit: 20 });
    expect(items.some((item) => item.id === post.id)).toBe(false);

    const pinnedList = await listPinnedPosts(db);
    expect(pinnedList.some((item) => item.id === post.id)).toBe(true);

    await unpinPost(db, post.id, admin.id);
    const { items: itemsAfterUnpin } = await listFeedPosts(db, { limit: 20 });
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
});
