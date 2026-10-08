import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  acceptGroupInvite,
  approveJoinRequest,
  createGroup,
  declineInvite,
  declineJoinRequest,
  getGroupBySlug,
  GroupForbiddenError,
  GroupOwnerError,
  GroupVisibilityError,
  inviteMember,
  leaveGroup,
  listActiveGroupMembers,
  listGroups,
  listGroupsForUser,
  removeMember,
  requestToJoin,
  transferOwnership,
  updateGroupVisibility,
} from "./group-service";
import { listAuditLog } from "./moderation-service";

const { auditLog, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("group-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string, role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}`, role })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a group with the creator as an active owner, and it shows up in the directory", async () => {
    const owner = await makeMember("owner-create");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Parents Group",
      visibility: "public",
    });

    const view = await getGroupBySlug(db, group.slug, owner.id);
    expect(view?.memberCount).toBe(1);
    expect(view?.myMembership).toEqual({ role: "owner", status: "active" });

    const directory = await listGroups(db, { limit: 50 });
    expect(directory.items.some((row) => row.id === group.id)).toBe(true);
  });

  it("never lists a private group in the directory", async () => {
    const owner = await makeMember("owner-private-dir");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Secret Club",
      visibility: "private",
    });

    const directory = await listGroups(db, { limit: 50 });
    expect(directory.items.some((row) => row.id === group.id)).toBe(false);
  });

  it("lets a non-member request to join a public group, and the owner approve it", async () => {
    const owner = await makeMember("owner-join");
    const requester = await makeMember("requester-join");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Book Club",
      visibility: "public",
    });

    await requestToJoin(db, group.id, requester.id);
    let view = await getGroupBySlug(db, group.slug, requester.id);
    expect(view?.myMembership?.status).toBe("requested");

    await approveJoinRequest(db, group.id, requester.id, owner.id);
    view = await getGroupBySlug(db, group.slug, requester.id);
    expect(view?.myMembership).toEqual({ role: "member", status: "active" });

    const members = await listActiveGroupMembers(db, group.id);
    expect(members.map((member) => member.userId)).toContain(requester.id);
  });

  it("lets the owner decline a join request", async () => {
    const owner = await makeMember("owner-decline");
    const requester = await makeMember("requester-decline");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Running Club",
      visibility: "public",
    });

    await requestToJoin(db, group.id, requester.id);
    await declineJoinRequest(db, group.id, requester.id, owner.id);

    const view = await getGroupBySlug(db, group.slug, requester.id);
    expect(view?.myMembership).toBeNull();
  });

  it("rejects a join request against a private group", async () => {
    const owner = await makeMember("owner-private-join");
    const outsider = await makeMember("outsider-private-join");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Invite Only",
      visibility: "private",
    });

    await expect(requestToJoin(db, group.id, outsider.id)).rejects.toThrow(GroupVisibilityError);
  });

  it("invite/accept skips approval but still requires the invitee's own acceptance", async () => {
    const owner = await makeMember("owner-invite");
    const invitee = await makeMember("invitee-invite");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Garden Club",
      visibility: "public",
    });

    await inviteMember(db, group.id, invitee.id, owner.id);
    let view = await getGroupBySlug(db, group.slug, invitee.id);
    expect(view?.myMembership?.status).toBe("invited");

    await acceptGroupInvite(db, group.id, invitee.id);
    view = await getGroupBySlug(db, group.slug, invitee.id);
    expect(view?.myMembership?.status).toBe("active");
  });

  it("lets an invitee decline an invite", async () => {
    const owner = await makeMember("owner-invite-decline");
    const invitee = await makeMember("invitee-invite-decline");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Chess Club",
      visibility: "public",
    });

    await inviteMember(db, group.id, invitee.id, owner.id);
    await declineInvite(db, group.id, invitee.id);

    const view = await getGroupBySlug(db, group.slug, invitee.id);
    expect(view?.myMembership).toBeNull();
  });

  it("only an owner/admin can invite or approve - a plain member can't", async () => {
    const owner = await makeMember("owner-forbidden");
    const member = await makeMember("member-forbidden");
    const target = await makeMember("target-forbidden");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Soccer",
      visibility: "public",
    });

    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);

    await expect(inviteMember(db, group.id, target.id, member.id)).rejects.toThrow(
      GroupForbiddenError,
    );
  });

  it("lets a member leave, but blocks the owner from leaving without transferring first", async () => {
    const owner = await makeMember("owner-leave");
    const member = await makeMember("member-leave");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Hiking",
      visibility: "public",
    });

    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);
    await leaveGroup(db, group.id, member.id);

    const view = await getGroupBySlug(db, group.slug, member.id);
    expect(view?.myMembership).toBeNull();

    await expect(leaveGroup(db, group.id, owner.id)).rejects.toThrow(GroupOwnerError);
  });

  it("transfers ownership - the old owner is demoted to admin, not removed", async () => {
    const owner = await makeMember("owner-transfer");
    const member = await makeMember("member-transfer");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Photography",
      visibility: "public",
    });

    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);
    await transferOwnership(db, group.id, owner.id, member.id);

    const newOwnerView = await getGroupBySlug(db, group.slug, member.id);
    expect(newOwnerView?.myMembership?.role).toBe("owner");
    expect(newOwnerView?.ownerId).toBe(member.id);

    const oldOwnerView = await getGroupBySlug(db, group.slug, owner.id);
    expect(oldOwnerView?.myMembership?.role).toBe("admin");

    // Having been demoted, the old owner can now leave without transferring again.
    await leaveGroup(db, group.id, owner.id);
  });

  it("owner/admin can remove a member, but not the owner", async () => {
    const owner = await makeMember("owner-remove");
    const member = await makeMember("member-remove");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Cycling",
      visibility: "public",
    });

    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);
    await removeMember(db, group.id, member.id, owner.id);

    const view = await getGroupBySlug(db, group.slug, member.id);
    expect(view?.myMembership).toBeNull();

    await expect(removeMember(db, group.id, owner.id, owner.id)).rejects.toThrow(
      GroupForbiddenError,
    );
  });

  it("listGroupsForUser only ever returns public memberships", async () => {
    const owner = await makeMember("owner-list-mine");
    const publicGroup = await createGroup(db, {
      ownerId: owner.id,
      name: "Public Hobby",
      visibility: "public",
    });
    const privateGroup = await createGroup(db, {
      ownerId: owner.id,
      name: "Private Hobby",
      visibility: "private",
    });

    const mine = await listGroupsForUser(db, owner.id);
    expect(mine.map((row) => row.id)).toContain(publicGroup.id);
    expect(mine.map((row) => row.id)).not.toContain(privateGroup.id);
  });

  it("404s a private group for a non-member, but lets a site admin in and audit-logs the access", async () => {
    const owner = await makeMember("owner-admin-access");
    const outsider = await makeMember("outsider-admin-access");
    const admin = await makeMember("site-admin-access", "admin");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Hidden Group",
      visibility: "private",
    });

    const outsiderView = await getGroupBySlug(db, group.slug, outsider.id);
    expect(outsiderView).toBeNull();

    const adminView = await getGroupBySlug(db, group.slug, admin.id);
    expect(adminView?.id).toBe(group.id);

    const logged = await listAuditLog(db, admin.id, 50);
    expect(logged.some((row) => row.targetId === group.id && row.targetType === "group")).toBe(
      true,
    );

    // And directly against the table, to confirm the actor and action, not just that some
    // entry for this group exists.
    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, group.id));
    expect(
      rows.some((row) => row.action === "view_private_group" && row.actorId === admin.id),
    ).toBe(true);
  });

  it("switching visibility is owner/admin only", async () => {
    const owner = await makeMember("owner-visibility");
    const outsider = await makeMember("outsider-visibility");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Visibility Test",
      visibility: "public",
    });

    await expect(updateGroupVisibility(db, group.id, outsider.id, "private")).rejects.toThrow(
      GroupForbiddenError,
    );

    await updateGroupVisibility(db, group.id, owner.id, "private");
    const view = await getGroupBySlug(db, group.slug, owner.id);
    expect(view?.visibility).toBe("private");
  });
});
