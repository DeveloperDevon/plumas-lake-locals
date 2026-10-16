import { createDb, schema } from "@plumas/db";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { describe, expect, it } from "vitest";

import { deleteOwnAccount, GHOST_USER_EMAIL } from "./account-deletion-service";
import { addManager } from "./business-service";
import { createComment } from "./comment-service";
import {
  createDirectConversation,
  createGroupConversation,
  listMessages,
  registerDevice,
} from "./dm-service";
import { acceptGroupInvite, createGroup, getGroupBySlug, inviteMember } from "./group-service";
import { createInvite } from "./invite-service";
import { createMedia } from "./media-service";
import { createReport, writeAuditLog } from "./moderation-service";
import { createPost, setPostReaction } from "./post-service";

const {
  auditLog,
  businessManagers,
  businesses,
  comments,
  conversations,
  devices,
  groups,
  invites,
  listings,
  media,
  posts,
  reactions,
  reports,
  users,
} = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("account-deletion-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string) {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}` })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  async function getGhost() {
    const [ghost] = await db.select().from(users).where(eq(users.email, GHOST_USER_EMAIL));
    if (!ghost) throw new Error("ghost user was not created");
    return ghost;
  }

  it("deletes a user with no owned content", async () => {
    const solo = await makeMember("solo");
    await deleteOwnAccount(db, solo.id);

    const [row] = await db.select().from(users).where(eq(users.id, solo.id));
    expect(row).toBeUndefined();
  });

  it("reuses the same ghost user and device across multiple deletions", async () => {
    const first = await makeMember("ghost-reuse-1");
    const second = await makeMember("ghost-reuse-2");

    await deleteOwnAccount(db, first.id);
    const ghostAfterFirst = await getGhost();

    await deleteOwnAccount(db, second.id);
    const ghostAfterSecond = await getGhost();
    expect(ghostAfterSecond.id).toBe(ghostAfterFirst.id);
    expect(ghostAfterSecond.status).toBe("suspended");

    const ghostDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.userId, ghostAfterSecond.id));
    expect(ghostDevices.length).toBeGreaterThan(0);
  });

  it("reassigns posts and comments to the ghost, scrubs the body, and leaves other members' content alone", async () => {
    const author = await makeMember("author-posts");
    const other = await makeMember("other-posts");
    const post = await createPost(db, { authorId: author.id, body: "my post" });
    const comment = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "my comment",
    });
    const otherPost = await createPost(db, { authorId: other.id, body: "someone else's post" });
    const otherComment = await createComment(db, {
      postId: otherPost.id,
      userId: other.id,
      body: "someone else's comment",
    });

    await deleteOwnAccount(db, author.id);
    const ghost = await getGhost();

    const [deletedPost] = await db.select().from(posts).where(eq(posts.id, post.id));
    expect(deletedPost?.authorId).toBe(ghost.id);
    expect(deletedPost?.body).toBe("");
    expect(deletedPost?.deletedAt).not.toBeNull();

    const [deletedComment] = await db.select().from(comments).where(eq(comments.id, comment.id));
    expect(deletedComment?.userId).toBe(ghost.id);
    expect(deletedComment?.body).toBe("");
    expect(deletedComment?.deletedAt).not.toBeNull();

    const [survivingPost] = await db.select().from(posts).where(eq(posts.id, otherPost.id));
    expect(survivingPost?.authorId).toBe(other.id);
    expect(survivingPost?.body).toBe("someone else's post");

    const [survivingComment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, otherComment.id));
    expect(survivingComment?.userId).toBe(other.id);
    expect(survivingComment?.body).toBe("someone else's comment");
  });

  it("hard-deletes this member's own reactions, leaving another member's reaction on the same post intact", async () => {
    const reactor = await makeMember("reactor");
    const otherReactor = await makeMember("other-reactor");
    const postAuthor = await makeMember("reaction-post-author");
    const post = await createPost(db, { authorId: postAuthor.id, body: "react to me" });

    await setPostReaction(db, post.id, reactor.id, "like");
    await setPostReaction(db, post.id, otherReactor.id, "love");

    await deleteOwnAccount(db, reactor.id);

    const remaining = await db
      .select()
      .from(reactions)
      .where(and(eq(reactions.targetType, "post"), eq(reactions.targetId, post.id)));
    expect(remaining.some((row) => row.userId === reactor.id)).toBe(false);
    expect(remaining.some((row) => row.userId === otherReactor.id)).toBe(true);
  });

  it("promotes another active member to group owner when one exists", async () => {
    const owner = await makeMember("group-owner-with-successor");
    const member = await makeMember("group-successor");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Has A Successor",
      visibility: "public",
    });
    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);

    await deleteOwnAccount(db, owner.id);

    const view = await getGroupBySlug(db, group.slug, member.id);
    expect(view?.ownerId).toBe(member.id);
    expect(view?.myMembership?.role).toBe("owner");
  });

  it("falls back to the ghost as group owner when the deleted member was the sole member", async () => {
    const owner = await makeMember("group-owner-sole");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Sole Member Group",
      visibility: "public",
    });

    await deleteOwnAccount(db, owner.id);
    const ghost = await getGhost();

    const [row] = await db.select().from(groups).where(eq(groups.id, group.id));
    expect(row?.ownerId).toBe(ghost.id);
  });

  it("promotes another manager to business owner when one exists", async () => {
    const owner = await makeMember("biz-owner-with-successor");
    const manager = await makeMember("biz-successor");
    const [business] = await db
      .insert(businesses)
      .values({
        slug: `biz-${crypto.randomUUID()}`,
        name: "Has A Successor",
        serviceArea: "Plumas Lake",
      })
      .returning();
    if (!business) throw new Error("setup failed");
    await db
      .insert(businessManagers)
      .values({ businessId: business.id, userId: owner.id, role: "owner" });
    await addManager(db, business.id, manager.id, owner.id);

    await deleteOwnAccount(db, owner.id);

    const [managerRow] = await db
      .select()
      .from(businessManagers)
      .where(
        and(eq(businessManagers.businessId, business.id), eq(businessManagers.userId, manager.id)),
      );
    expect(managerRow?.role).toBe("owner");
  });

  it("leaves a business with zero managers when the deleted member was the sole manager, without deleting the page", async () => {
    const owner = await makeMember("biz-owner-sole");
    const [business] = await db
      .insert(businesses)
      .values({
        slug: `biz-${crypto.randomUUID()}`,
        name: "Sole Manager Business",
        serviceArea: "Plumas Lake",
      })
      .returning();
    if (!business) throw new Error("setup failed");
    await db
      .insert(businessManagers)
      .values({ businessId: business.id, userId: owner.id, role: "owner" });

    await deleteOwnAccount(db, owner.id);

    const [row] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(row).toBeDefined();
    const managers = await db
      .select()
      .from(businessManagers)
      .where(eq(businessManagers.businessId, business.id));
    expect(managers).toHaveLength(0);
  });

  it("reassigns a listing's sellerId to the ghost and closes it", async () => {
    const seller = await makeMember("listing-seller");
    const [listing] = await db
      .insert(listings)
      .values({
        sellerId: seller.id,
        kind: "item",
        type: "sale",
        title: "Old bike",
        category: "household",
        priceCents: 1000,
        priceUnit: "fixed",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      })
      .returning();
    if (!listing) throw new Error("setup failed");

    await deleteOwnAccount(db, seller.id);
    const ghost = await getGhost();

    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row?.sellerId).toBe(ghost.id);
    expect(row?.status).toBe("closed");
  });

  it("reassigns owned media rows to the ghost rather than deleting them", async () => {
    const uploader = await makeMember("media-uploader");
    const row = await createMedia(db, {
      id: crypto.randomUUID(),
      ownerId: uploader.id,
      r2Key: `uploads/${crypto.randomUUID()}.jpg`,
      width: 100,
      height: 100,
    });

    await deleteOwnAccount(db, uploader.id);
    const ghost = await getGhost();

    const [after] = await db.select().from(media).where(eq(media.id, row.id));
    expect(after?.ownerId).toBe(ghost.id);
  });

  it("reassigns a group conversation's creatorId, and messages to the ghost device, while leaving a direct conversation's directUserA/B untouched", async () => {
    const alice = await makeMember("dm-alice");
    const bob = await makeMember("dm-bob");
    const aliceDevice = await registerDevice(db, alice.id, {
      signaturePublicKey: Buffer.from(`sig-${crypto.randomUUID()}`),
    });

    const direct = await createDirectConversation(db, {
      conversationId: uuidv7(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    const group = await createGroupConversation(db, {
      conversationId: uuidv7(),
      creatorId: alice.id,
      creatorDeviceId: aliceDevice.id,
      name: "Neighbors",
      memberUserIds: [bob.id],
      epoch: 1,
      welcomeBytes: Buffer.from("group-welcome"),
    });

    const directUserAWasAlice = direct.directUserA === alice.id;

    await deleteOwnAccount(db, alice.id);
    const ghost = await getGhost();
    const [ghostDevice] = await db.select().from(devices).where(eq(devices.userId, ghost.id));
    if (!ghostDevice) throw new Error("ghost device missing");

    const [directAfter] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, direct.id));
    // No FK on directUserA/B, left exactly as it was - still points at alice's now-deleted id.
    expect(directAfter?.directUserA).toBe(directUserAWasAlice ? alice.id : direct.directUserA);
    expect(directAfter?.directUserB).toBe(directUserAWasAlice ? direct.directUserB : alice.id);

    const [groupAfter] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, group.id));
    expect(groupAfter?.creatorId).toBe(ghost.id);

    const groupMessages = await listMessages(db, {
      conversationId: group.id,
      userId: bob.id,
      limit: 10,
    });
    expect(groupMessages.every((row) => row.senderDeviceId === ghostDevice.id)).toBe(true);
    expect(groupMessages.every((row) => row.senderDisplayName === "Deleted member")).toBe(true);

    // The alice device row itself is gone (cascade), confirming the message reassignment
    // actually unblocked it rather than leaving it dangling.
    const [aliceDeviceAfter] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, aliceDevice.id));
    expect(aliceDeviceAfter).toBeUndefined();
  });

  it("reassigns invites, reports and audit log entries authored by the deleted member", async () => {
    const inviter = await makeMember("inviter-to-delete");
    const invite = await createInvite(db, { inviterId: inviter.id, email: uniqueEmail("invitee") });

    const reporter = await makeMember("reporter-to-delete");
    const reportedTarget = await makeMember("report-target");
    const report = await createReport(db, {
      actorId: reporter.id,
      targetType: "profile",
      targetId: reportedTarget.id,
      reason: "spam",
    });

    const admin = await makeMember("admin-to-delete");
    await db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
    await writeAuditLog(db, {
      action: "suspend_user",
      targetType: "user",
      targetId: reportedTarget.id,
      actorId: admin.id,
    });

    await deleteOwnAccount(db, inviter.id);
    await deleteOwnAccount(db, reporter.id);
    await deleteOwnAccount(db, admin.id);
    const ghost = await getGhost();

    const [inviteRow] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(inviteRow?.inviterId).toBe(ghost.id);

    const [reportRow] = await db.select().from(reports).where(eq(reports.id, report.id));
    expect(reportRow?.actorId).toBe(ghost.id);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetType, "user"), eq(auditLog.targetId, reportedTarget.id)));
    expect(auditRows.some((row) => row.actorId === ghost.id)).toBe(true);
  });

  it("reparents another member's invitedBy to the ghost instead of leaving it dangling", async () => {
    const inviter = await makeMember("invited-by-chain");
    const [invitee] = await db
      .insert(users)
      .values({
        email: uniqueEmail("invitee-chain"),
        displayName: "Invited chain member",
        invitedBy: inviter.id,
      })
      .returning();
    if (!invitee) throw new Error("setup failed");

    await deleteOwnAccount(db, inviter.id);
    const ghost = await getGhost();

    const [row] = await db.select().from(users).where(eq(users.id, invitee.id));
    expect(row?.invitedBy).toBe(ghost.id);
  });
});
