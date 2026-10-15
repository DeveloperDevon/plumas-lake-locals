import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createComment } from "./comment-service";
import { exportAccountData } from "./export-service";
import { createGroup } from "./group-service";
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

describe("export-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string) {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}` })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("includes this member's own posts, comments and groups", async () => {
    const owner = await makeMember("owner-export");
    const post = await createPost(db, { authorId: owner.id, body: "My own post" });
    await createComment(db, { postId: post.id, userId: owner.id, body: "My own comment" });
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "My export group",
      visibility: "public",
    });

    const bundle = await exportAccountData(db, owner.id);
    expect(bundle.profile?.id).toBe(owner.id);
    expect(bundle.posts.some((row) => row.id === post.id)).toBe(true);
    expect(bundle.comments.some((row) => row.body === "My own comment")).toBe(true);
    expect(bundle.groupMemberships.some((row) => row.id === group.id && row.role === "owner")).toBe(
      true,
    );
  });

  it("does not include another member's content, even when it's attached to this member's own post", async () => {
    const owner = await makeMember("owner-isolation");
    const commenter = await makeMember("commenter-isolation");
    const post = await createPost(db, { authorId: owner.id, body: "Owner's post" });
    await createComment(db, {
      postId: post.id,
      userId: commenter.id,
      body: "Someone else's comment",
    });

    const ownerBundle = await exportAccountData(db, owner.id);
    expect(ownerBundle.posts.some((row) => row.id === post.id)).toBe(true);
    expect(ownerBundle.comments.some((row) => row.body === "Someone else's comment")).toBe(false);

    const commenterBundle = await exportAccountData(db, commenter.id);
    expect(commenterBundle.comments.some((row) => row.body === "Someone else's comment")).toBe(
      true,
    );
    expect(commenterBundle.posts.some((row) => row.id === post.id)).toBe(false);
  });
});
