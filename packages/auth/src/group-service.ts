import { type Database, schema } from "@plumas/db";
import type { GroupMemberRole, GroupVisibility } from "@plumas/validators";
import { and, count, desc, eq, ilike, lt, notInArray } from "drizzle-orm";

import { writeAuditLog } from "./moderation-service";
import { createNotification } from "./notification-service";

const { groupMembers, groups, users } = schema;

export class GroupNotFoundError extends Error {
  constructor(message = "That group no longer exists.") {
    super(message);
  }
}

export class GroupForbiddenError extends Error {
  constructor(message = "You can't do that in this group.") {
    super(message);
  }
}

export class GroupVisibilityError extends Error {
  constructor(message = "Private groups don't accept join requests - ask an admin to invite you.") {
    super(message);
  }
}

export class GroupOwnerError extends Error {
  constructor(message = "Transfer ownership to someone else before leaving.") {
    super(message);
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "group";
}

async function uniqueSlug(database: Database, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 0;
  for (;;) {
    const [existing] = await database
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.slug, candidate));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix.toString()}`;
  }
}

export interface CreateGroupInput {
  ownerId: string;
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  visibility: GroupVisibility;
}

/** FR-GRP-01/07: the creator becomes the group's owner, active from the start. */
export async function createGroup(database: Database, input: CreateGroupInput) {
  const slug = await uniqueSlug(database, input.name);
  const [row] = await database
    .insert(groups)
    .values({
      slug,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      ownerId: input.ownerId,
      visibility: input.visibility,
    })
    .returning();
  if (!row) throw new Error("Failed to create group");

  await database.insert(groupMembers).values({
    groupId: row.id,
    userId: input.ownerId,
    role: "owner",
    status: "active",
  });

  return row;
}

async function getMembership(database: Database, groupId: string, userId: string) {
  const [row] = await database
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  return row ?? null;
}

export async function requireGroupAdmin(database: Database, groupId: string, actingUserId: string) {
  const membership = await getMembership(database, groupId, actingUserId);
  if (membership?.status !== "active" || membership.role === "member") {
    throw new GroupForbiddenError("Only the group's owner or admins can do that.");
  }
  return membership;
}

export async function requireActiveGroupMember(
  database: Database,
  groupId: string,
  userId: string,
) {
  const membership = await getMembership(database, groupId, userId);
  if (membership?.status !== "active") {
    throw new GroupForbiddenError("Only active members can do that.");
  }
  return membership;
}

export interface GroupMembership {
  role: GroupMemberRole;
  status: "requested" | "invited" | "active";
}

export interface GroupView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  coverKey: string | null;
  coverAltText: string | null;
  ownerId: string;
  visibility: GroupVisibility;
  createdAt: Date;
  memberCount: number;
  myMembership: GroupMembership | null;
}

async function activeMemberCount(database: Database, groupId: string): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")));
  return row?.value ?? 0;
}

/**
 * FR-GRP-12: returns null both when the group doesn't exist and when it's private and the
 * viewer isn't an active member - the caller (the server function layer) turns either case
 * into a 404, never revealing which one it was. The one exception is a site admin, who gets
 * the group back AND has the access audit-logged (FR-GRP-13).
 */
export async function getGroupBySlug(
  database: Database,
  slug: string,
  viewerId: string,
): Promise<GroupView | null> {
  const [row] = await database.select().from(groups).where(eq(groups.slug, slug));
  if (!row) return null;

  const membership = await getMembership(database, row.id, viewerId);
  const isActiveMember = membership?.status === "active";

  if (row.visibility === "private" && !isActiveMember) {
    const [viewer] = await database.select().from(users).where(eq(users.id, viewerId));
    if (viewer?.role !== "admin") return null;
    await writeAuditLog(database, {
      action: "view_private_group",
      targetType: "group",
      targetId: row.id,
      actorId: viewerId,
    });
  }

  const memberCount = await activeMemberCount(database, row.id);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    coverKey: row.coverKey,
    coverAltText: row.coverAltText,
    ownerId: row.ownerId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    memberCount,
    myMembership: membership ? { role: membership.role, status: membership.status } : null,
  };
}

export interface ListGroupsInput {
  search?: string | undefined;
  category?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  coverKey: string | null;
  memberCount: number;
  createdAt: Date;
}

export interface GroupsPage {
  items: GroupSummary[];
  nextCursor: string | null;
}

/** FR-GRP-02: public groups only - the directory never reveals a private group. */
export async function listGroups(database: Database, input: ListGroupsInput): Promise<GroupsPage> {
  const conditions = [eq(groups.visibility, "public")];
  if (input.search) conditions.push(ilike(groups.name, `%${input.search}%`));
  if (input.category) conditions.push(eq(groups.category, input.category));
  if (input.cursor) conditions.push(lt(groups.createdAt, new Date(input.cursor)));

  const rows = await database
    .select()
    .from(groups)
    .where(and(...conditions))
    .orderBy(desc(groups.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const counts = await Promise.all(page.map((row) => activeMemberCount(database, row.id)));
  const lastRow = page[page.length - 1];

  return {
    items: page.map((row, index) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      coverKey: row.coverKey,
      memberCount: counts[index] ?? 0,
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore && lastRow ? lastRow.createdAt.toISOString() : null,
  };
}

/**
 * FR-GRP-11: public memberships only, by design - used for both the directory's "My groups"
 * and the profile's Groups section, so a profile (including your own) never surfaces a private
 * membership. There's no viewer-is-the-owner special case to get wrong.
 */
export async function listGroupsForUser(
  database: Database,
  userId: string,
): Promise<GroupSummary[]> {
  const rows = await database
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      category: groups.category,
      coverKey: groups.coverKey,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, "active"),
        eq(groups.visibility, "public"),
      ),
    )
    .orderBy(desc(groups.createdAt));

  const counts = await Promise.all(rows.map((row) => activeMemberCount(database, row.id)));
  return rows.map((row, index) => ({ ...row, memberCount: counts[index] ?? 0 }));
}

/**
 * FR-CAL-02: every group the user can actually post as (public or private) - used only for the
 * user's own "pick a host" pickers, never surfaced to other viewers, so there's no FR-GRP-11
 * leak the way there would be in listGroupsForUser.
 */
export async function listHostableGroupsForUser(
  database: Database,
  userId: string,
): Promise<GroupSummary[]> {
  const rows = await database
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      category: groups.category,
      coverKey: groups.coverKey,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, "active")))
    .orderBy(desc(groups.createdAt));

  const counts = await Promise.all(rows.map((row) => activeMemberCount(database, row.id)));
  return rows.map((row, index) => ({ ...row, memberCount: counts[index] ?? 0 }));
}

/** FR-GRP-04: public groups only - private groups have no request-to-join (FR-GRP-11). */
export async function requestToJoin(database: Database, groupId: string, userId: string) {
  const [group] = await database.select().from(groups).where(eq(groups.id, groupId));
  if (!group) throw new GroupNotFoundError();
  if (group.visibility === "private") throw new GroupVisibilityError();

  const existing = await getMembership(database, groupId, userId);
  if (existing) return existing; // idempotent - already requested/invited/active

  const [row] = await database
    .insert(groupMembers)
    .values({ groupId, userId, role: "member", status: "requested" })
    .returning();
  if (!row) throw new Error("Failed to create join request");
  return row;
}

/** Either the requester cancelling their own request, or an owner/admin declining it. */
export async function declineJoinRequest(
  database: Database,
  groupId: string,
  targetUserId: string,
  actingUserId: string,
) {
  const byAdmin = actingUserId !== targetUserId;
  if (byAdmin) await requireGroupAdmin(database, groupId, actingUserId);
  await database
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

  // Only when an admin declines someone else's request - not when the requester cancels their own.
  if (byAdmin) await notifyJoinDecision(database, groupId, targetUserId, "group_join_declined");
}

async function notifyJoinDecision(
  database: Database,
  groupId: string,
  targetUserId: string,
  type: "group_join_approved" | "group_join_declined",
) {
  const [group] = await database
    .select({ name: groups.name, slug: groups.slug })
    .from(groups)
    .where(eq(groups.id, groupId));
  await createNotification(database, {
    userId: targetUserId,
    type,
    payload: { groupId, groupName: group?.name ?? "a group", groupSlug: group?.slug ?? null },
  });
}

/** FR-GRP-04: owner/admin only. */
export async function approveJoinRequest(
  database: Database,
  groupId: string,
  targetUserId: string,
  actingUserId: string,
) {
  await requireGroupAdmin(database, groupId, actingUserId);
  const [row] = await database
    .update(groupMembers)
    .set({ status: "active" })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, targetUserId),
        eq(groupMembers.status, "requested"),
      ),
    )
    .returning();
  if (!row) throw new GroupNotFoundError("That join request no longer exists.");
  await notifyJoinDecision(database, groupId, targetUserId, "group_join_approved");
  return row;
}

/** FR-GRP-05: owner/admin only; the invitee still accepts/declines - just skips approval. */
export async function inviteMember(
  database: Database,
  groupId: string,
  targetUserId: string,
  actingUserId: string,
) {
  await requireGroupAdmin(database, groupId, actingUserId);

  const existing = await getMembership(database, groupId, targetUserId);
  if (existing) return existing; // idempotent

  const [row] = await database
    .insert(groupMembers)
    .values({ groupId, userId: targetUserId, role: "member", status: "invited" })
    .returning();
  if (!row) throw new Error("Failed to invite member");
  return row;
}

export async function acceptGroupInvite(database: Database, groupId: string, userId: string) {
  const [row] = await database
    .update(groupMembers)
    .set({ status: "active" })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, "invited"),
      ),
    )
    .returning();
  if (!row) throw new GroupNotFoundError("That invite no longer exists.");
  return row;
}

export async function declineInvite(database: Database, groupId: string, userId: string) {
  await database
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, "invited"),
      ),
    );
}

/** FR-GRP-08: owner/admin only; the owner can't be removed this way - transfer first. */
export async function removeMember(
  database: Database,
  groupId: string,
  targetUserId: string,
  actingUserId: string,
) {
  await requireGroupAdmin(database, groupId, actingUserId);

  const target = await getMembership(database, groupId, targetUserId);
  if (target?.role === "owner") {
    throw new GroupForbiddenError("The owner can't be removed - transfer ownership first.");
  }

  await database
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));
}

/** FR-GRP-08: any member can leave, except the owner (must transfer ownership first). */
export async function leaveGroup(database: Database, groupId: string, userId: string) {
  const membership = await getMembership(database, groupId, userId);
  if (!membership) return;
  if (membership.role === "owner") throw new GroupOwnerError();

  await database
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

/** FR-GRP-07: current owner only; the old owner is demoted to admin, not removed. */
export async function transferOwnership(
  database: Database,
  groupId: string,
  currentOwnerId: string,
  newOwnerId: string,
) {
  const [group] = await database.select().from(groups).where(eq(groups.id, groupId));
  if (!group) throw new GroupNotFoundError();
  if (group.ownerId !== currentOwnerId) {
    throw new GroupForbiddenError("Only the current owner can transfer ownership.");
  }

  const newOwnerMembership = await getMembership(database, groupId, newOwnerId);
  if (newOwnerMembership?.status !== "active") {
    throw new GroupForbiddenError("Ownership can only be transferred to an active member.");
  }

  await database.update(groups).set({ ownerId: newOwnerId }).where(eq(groups.id, groupId));
  await database
    .update(groupMembers)
    .set({ role: "owner" })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, newOwnerId)));
  await database
    .update(groupMembers)
    .set({ role: "admin" })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentOwnerId)));
}

export interface UpdateGroupInput {
  groupId: string;
  actingUserId: string;
  name: string;
  description?: string | undefined;
  category?: string | undefined;
}

/** FR-GRP-01: owner/admin only. */
export async function updateGroup(database: Database, input: UpdateGroupInput) {
  await requireGroupAdmin(database, input.groupId, input.actingUserId);
  const [row] = await database
    .update(groups)
    .set({
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
    })
    .where(eq(groups.id, input.groupId))
    .returning();
  if (!row) throw new GroupNotFoundError();
  return row;
}

/** FR-GRP-10: owner/admin only - the UI's own confirmation step happens before this is called. */
export async function updateGroupVisibility(
  database: Database,
  groupId: string,
  actingUserId: string,
  visibility: GroupVisibility,
) {
  await requireGroupAdmin(database, groupId, actingUserId);
  const [row] = await database
    .update(groups)
    .set({ visibility })
    .where(eq(groups.id, groupId))
    .returning();
  if (!row) throw new GroupNotFoundError();
  return row;
}

export interface GroupMemberView {
  userId: string;
  displayName: string;
  avatarKey: string | null;
  role: GroupMemberRole;
}

/** FR-GRP-03: active members (incl. admins) are visible even to non-members. */
export async function listActiveGroupMembers(
  database: Database,
  groupId: string,
): Promise<GroupMemberView[]> {
  const rows = await database
    .select({
      userId: users.id,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, "active")))
    .orderBy(groupMembers.createdAt);
  return rows;
}

export interface PendingMemberView {
  userId: string;
  displayName: string;
  avatarKey: string | null;
}

async function listByStatus(
  database: Database,
  groupId: string,
  status: "requested" | "invited",
  actingUserId: string,
): Promise<PendingMemberView[]> {
  await requireGroupAdmin(database, groupId, actingUserId);
  return database
    .select({ userId: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, status)))
    .orderBy(groupMembers.createdAt);
}

/** FR-GRP-04: owner/admin only. */
export function listPendingJoinRequests(database: Database, groupId: string, actingUserId: string) {
  return listByStatus(database, groupId, "requested", actingUserId);
}

/** FR-GRP-05: owner/admin only - outstanding invites not yet accepted/declined. */
export function listPendingInvitesForGroup(
  database: Database,
  groupId: string,
  actingUserId: string,
) {
  return listByStatus(database, groupId, "invited", actingUserId);
}

export interface MyInviteView {
  groupId: string;
  groupSlug: string;
  groupName: string;
}

/** The pending-tray counterpart to listPendingInvitesForGroup, from the invitee's side. */
export async function listMyGroupInvites(
  database: Database,
  userId: string,
): Promise<MyInviteView[]> {
  const rows = await database
    .select({ groupId: groups.id, groupSlug: groups.slug, groupName: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, "invited")))
    .orderBy(desc(groupMembers.createdAt));
  return rows;
}

/** Member search for the invite-by-search box - anyone already on the group's roster is excluded. */
export async function searchInvitableMembers(database: Database, groupId: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const existingRows = await database
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const existingIds = existingRows.map((row) => row.userId);

  const conditions = [ilike(users.displayName, `%${trimmed}%`), eq(users.status, "active")];
  if (existingIds.length > 0) conditions.push(notInArray(users.id, existingIds));

  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(and(...conditions))
    .limit(20);
}
