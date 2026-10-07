import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createComment } from "./comment-service";
import {
  adminDeleteContent,
  createReport,
  listAuditLog,
  listInviteTree,
  listMembersForAdmin,
  listOpenReports,
  ModerationForbiddenError,
  resolveReport,
  suspendUser,
  unsuspendUser,
} from "./moderation-service";
import { createPost } from "./post-service";

const { auditLog, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("moderation-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(role: "member" | "admin" = "member", invitedBy?: string) {
    const [user] = await db
      .insert(users)
      .values({
        email: uniqueEmail(role),
        displayName: `Test ${role}`,
        role,
        invitedBy: invitedBy ?? null,
      })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("rejects every admin action from a non-admin", async () => {
    const member = await makeMember();
    const admin = await makeMember("admin");
    const post = await createPost(db, { authorId: admin.id, body: "Hello" });
    const report = await createReport(db, {
      actorId: member.id,
      targetType: "post",
      targetId: post.id,
      reason: "spam",
    });

    await expect(resolveReport(db, report.id, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(suspendUser(db, admin.id, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(unsuspendUser(db, admin.id, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(adminDeleteContent(db, "post", post.id, member.id)).rejects.toThrow(
      ModerationForbiddenError,
    );
    await expect(listOpenReports(db, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(listMembersForAdmin(db, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(listInviteTree(db, member.id)).rejects.toThrow(ModerationForbiddenError);
    await expect(listAuditLog(db, member.id)).rejects.toThrow(ModerationForbiddenError);
  });

  it("lists an open report with a post preview and the reporter's name, resolves it, and writes an audit log row", async () => {
    const member = await makeMember();
    const admin = await makeMember("admin");
    const post = await createPost(db, { authorId: member.id, body: "Buy my stuff" });
    const report = await createReport(db, {
      actorId: admin.id,
      targetType: "post",
      targetId: post.id,
      reason: "spam",
    });

    const open = await listOpenReports(db, admin.id);
    expect(open).toContainEqual(
      expect.objectContaining({
        id: report.id,
        preview: "Buy my stuff",
        reporterDisplayName: admin.displayName,
      }),
    );

    const resolved = await resolveReport(db, report.id, admin.id);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await listOpenReports(db, admin.id)).not.toContainEqual(
      expect.objectContaining({ id: report.id }),
    );

    const logs = await db.select().from(auditLog).where(eq(auditLog.targetId, report.id));
    expect(logs).toContainEqual(
      expect.objectContaining({ action: "resolve_report", actorId: admin.id }),
    );
  });

  it("admin-deletes a post and a comment, bypassing the author-only check, and logs each", async () => {
    const author = await makeMember();
    const admin = await makeMember("admin");
    const post = await createPost(db, { authorId: author.id, body: "Spam post" });
    const comment = await createComment(db, {
      postId: post.id,
      userId: author.id,
      body: "Spam comment",
    });

    await adminDeleteContent(db, "post", post.id, admin.id);
    await adminDeleteContent(db, "comment", comment.id, admin.id);

    const [postRow] = await db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    const [commentRow] = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, comment.id));
    expect(postRow?.deletedAt).not.toBeNull();
    expect(commentRow?.deletedAt).not.toBeNull();

    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "delete_content"));
    expect(logs).toContainEqual(expect.objectContaining({ targetId: post.id }));
    expect(logs).toContainEqual(expect.objectContaining({ targetId: comment.id }));
  });

  it("suspends and unsuspends a member, each writing an audit log row", async () => {
    const member = await makeMember();
    const admin = await makeMember("admin");

    await suspendUser(db, member.id, admin.id);
    const [suspended] = await db.select().from(users).where(eq(users.id, member.id));
    expect(suspended?.status).toBe("suspended");

    await unsuspendUser(db, member.id, admin.id);
    const [reactivated] = await db.select().from(users).where(eq(users.id, member.id));
    expect(reactivated?.status).toBe("active");

    const logs = await db.select().from(auditLog).where(eq(auditLog.targetId, member.id));
    expect(logs).toContainEqual(expect.objectContaining({ action: "suspend_user" }));
    expect(logs).toContainEqual(expect.objectContaining({ action: "unsuspend_user" }));
  });

  it("assembles a multi-level invite tree rooted at members with no inviter", async () => {
    const admin = await makeMember("admin");
    const grandparentInviter = await makeMember("member", admin.id);
    const parentInvitee = await makeMember("member", grandparentInviter.id);
    const childInvitee = await makeMember("member", parentInvitee.id);

    const tree = await listInviteTree(db, admin.id);

    function findNode(nodes: typeof tree, id: string): (typeof tree)[number] | undefined {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(node.children, id);
        if (found) return found;
      }
      return undefined;
    }

    const adminNode = findNode(tree, admin.id);
    expect(adminNode).toBeDefined();
    const grandparentNode = findNode(adminNode?.children ?? [], grandparentInviter.id);
    expect(grandparentNode).toBeDefined();
    const parentNode = findNode(grandparentNode?.children ?? [], parentInvitee.id);
    expect(parentNode).toBeDefined();
    expect(parentNode?.children.some((child) => child.id === childInvitee.id)).toBe(true);
  });

  it("lists members for admin with role, status and inviter name", async () => {
    const admin = await makeMember("admin");
    const invitee = await makeMember("member", admin.id);

    const members = await listMembersForAdmin(db, admin.id);
    expect(members).toContainEqual(
      expect.objectContaining({
        id: invitee.id,
        role: "member",
        status: "active",
        inviterDisplayName: admin.displayName,
      }),
    );
  });
});
