import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createComment } from "./comment-service";
import {
  countUnreadNotifications,
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notification-service";
import { createPost, setPostReaction } from "./post-service";
import { requestRelationship } from "./relationship-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("notification-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember() {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("member"), displayName: "Test member", role: "member" })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  async function unreadFor(userId: string) {
    return listNotificationsForUser(db, { userId, limit: 50 });
  }

  it("creates, lists, counts unread, and marks a notification read", async () => {
    const member = await makeMember();
    await createNotification(db, {
      userId: member.id,
      type: "dm_message",
      payload: { foo: "bar" },
    });

    const before = await unreadFor(member.id);
    expect(before.items.length).toBeGreaterThanOrEqual(1);
    const row = before.items[0];
    if (!row) throw new Error("expected a notification row");
    expect(row.readAt).toBeNull();

    expect(await countUnreadNotifications(db, member.id)).toBeGreaterThanOrEqual(1);

    await markNotificationRead(db, row.id, member.id);
    const after = await unreadFor(member.id);
    const updated = after.items.find((item) => item.id === row.id);
    expect(updated?.readAt).not.toBeNull();
  });

  it("markNotificationRead does nothing for a notification owned by someone else", async () => {
    const owner = await makeMember();
    const stranger = await makeMember();
    await createNotification(db, { userId: owner.id, type: "dm_message", payload: {} });
    const [row] = (await unreadFor(owner.id)).items;
    if (!row) throw new Error("expected a notification row");

    await markNotificationRead(db, row.id, stranger.id);
    const stillUnread = (await unreadFor(owner.id)).items.find((item) => item.id === row.id);
    expect(stillUnread?.readAt).toBeNull();
  });

  it("markAllNotificationsRead clears every unread notification for that user only", async () => {
    const member = await makeMember();
    const other = await makeMember();
    await createNotification(db, { userId: member.id, type: "dm_message", payload: {} });
    await createNotification(db, { userId: member.id, type: "dm_message", payload: {} });
    await createNotification(db, { userId: other.id, type: "dm_message", payload: {} });

    await markAllNotificationsRead(db, member.id);

    expect(await countUnreadNotifications(db, member.id)).toBe(0);
    expect(await countUnreadNotifications(db, other.id)).toBeGreaterThanOrEqual(1);
  });

  it("notifies a post's author when someone else comments, but not when they comment on their own post", async () => {
    const author = await makeMember();
    const commenter = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Hello neighbors" });

    await createComment(db, { postId: post.id, userId: commenter.id, body: "Nice!" });
    const authorNotifications = await unreadFor(author.id);
    const commentNotification = authorNotifications.items.find(
      (item) => item.type === "comment_on_post",
    );
    expect(commentNotification).toBeDefined();

    const beforeSelfComment = (await unreadFor(author.id)).items.length;
    await createComment(db, { postId: post.id, userId: author.id, body: "Thanks all" });
    const afterSelfComment = (await unreadFor(author.id)).items.length;
    expect(afterSelfComment).toBe(beforeSelfComment);
  });

  it("notifies a post's author when someone else reacts, but not on a self-reaction", async () => {
    const author = await makeMember();
    const reactor = await makeMember();
    const post = await createPost(db, { authorId: author.id, body: "Garage sale Saturday" });

    await setPostReaction(db, post.id, reactor.id, "like");
    const notifications = await unreadFor(author.id);
    expect(notifications.items.some((item) => item.type === "reaction_on_post")).toBe(true);

    const before = (await unreadFor(author.id)).items.length;
    await setPostReaction(db, post.id, author.id, "like");
    const after = (await unreadFor(author.id)).items.length;
    expect(after).toBe(before);
  });

  it("notifies the recipient of a new relationship request", async () => {
    const from = await makeMember();
    const to = await makeMember();

    await requestRelationship(db, { fromUserId: from.id, toUserId: to.id, type: "friend" });

    const notifications = await unreadFor(to.id);
    const request = notifications.items.find((item) => item.type === "relationship_request");
    expect(request).toBeDefined();
    expect((request?.payload as Record<string, unknown>).actorId).toBe(from.id);
  });
});
