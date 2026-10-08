import {
  acceptGroupInvite,
  approveJoinRequest,
  createGroup,
  createPost,
  declineInvite,
  declineJoinRequest,
  getGroupBySlug,
  inviteMember,
  leaveGroup,
  listActiveGroupMembers,
  listGroupPosts,
  listGroups,
  listGroupsForUser,
  listMyGroupInvites,
  listPendingInvitesForGroup,
  listPendingJoinRequests,
  removeMember,
  requestToJoin,
  requireActiveGroupMember,
  searchInvitableMembers,
  transferOwnership,
  updateGroup,
  updateGroupVisibility,
} from "@plumas/auth";
import {
  createGroupSchema,
  createPostSchema,
  cursorPaginationSchema,
  groupIdSchema,
  groupMemberActionSchema,
  listGroupsSchema,
  transferGroupOwnershipSchema,
  updateGroupSchema,
  updateGroupVisibilitySchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getGroupsFn = createServerFn({ method: "GET" })
  .validator(listGroupsSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listGroups(getDb(), data);
  });

export const getMyGroupsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listGroupsForUser(getDb(), user.id);
});

export const getGroupsForUserFn = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listGroupsForUser(getDb(), data.userId);
  });

export const getMyGroupInvitesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listMyGroupInvites(getDb(), user.id);
});

/**
 * FR-GRP-12: returns null (never throws) for a group that doesn't exist or is private and the
 * viewer can't see - the route's own loader is what turns that into a 404, since TanStack's
 * notFound() is meant to be thrown from a loader, not from deep inside a server-fn RPC call.
 */
export const getGroupBySlugFn = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getGroupBySlug(getDb(), data.slug, user.id);
  });

export const getGroupMembersFn = createServerFn({ method: "GET" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listActiveGroupMembers(getDb(), data.groupId);
  });

export const createGroupFn = createServerFn({ method: "POST" })
  .validator(createGroupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createGroup(getDb(), { ownerId: user.id, ...data });
  });

export const updateGroupFn = createServerFn({ method: "POST" })
  .validator(updateGroupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateGroup(getDb(), { ...data, actingUserId: user.id });
  });

export const updateGroupVisibilityFn = createServerFn({ method: "POST" })
  .validator(updateGroupVisibilitySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateGroupVisibility(getDb(), data.groupId, user.id, data.visibility);
  });

export const requestToJoinFn = createServerFn({ method: "POST" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return requestToJoin(getDb(), data.groupId, user.id);
  });

export const cancelMyJoinRequestFn = createServerFn({ method: "POST" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await declineJoinRequest(getDb(), data.groupId, user.id, user.id);
    return { ok: true as const };
  });

export const approveJoinRequestFn = createServerFn({ method: "POST" })
  .validator(groupMemberActionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return approveJoinRequest(getDb(), data.groupId, data.targetUserId, user.id);
  });

export const declineJoinRequestFn = createServerFn({ method: "POST" })
  .validator(groupMemberActionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await declineJoinRequest(getDb(), data.groupId, data.targetUserId, user.id);
    return { ok: true as const };
  });

export const inviteMemberFn = createServerFn({ method: "POST" })
  .validator(groupMemberActionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return inviteMember(getDb(), data.groupId, data.targetUserId, user.id);
  });

export const acceptGroupInviteFn = createServerFn({ method: "POST" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return acceptGroupInvite(getDb(), data.groupId, user.id);
  });

export const declineGroupInviteFn = createServerFn({ method: "POST" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await declineInvite(getDb(), data.groupId, user.id);
    return { ok: true as const };
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator(groupMemberActionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removeMember(getDb(), data.groupId, data.targetUserId, user.id);
    return { ok: true as const };
  });

export const leaveGroupFn = createServerFn({ method: "POST" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await leaveGroup(getDb(), data.groupId, user.id);
    return { ok: true as const };
  });

export const transferGroupOwnershipFn = createServerFn({ method: "POST" })
  .validator(transferGroupOwnershipSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await transferOwnership(getDb(), data.groupId, user.id, data.newOwnerId);
    return { ok: true as const };
  });

export const getPendingJoinRequestsFn = createServerFn({ method: "GET" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listPendingJoinRequests(getDb(), data.groupId, user.id);
  });

export const getPendingGroupInvitesFn = createServerFn({ method: "GET" })
  .validator(groupIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listPendingInvitesForGroup(getDb(), data.groupId, user.id);
  });

export const searchInvitableMembersFn = createServerFn({ method: "GET" })
  .validator(z.object({ groupId: z.string().uuid(), query: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    return searchInvitableMembers(getDb(), data.groupId, data.query);
  });

export const getGroupPostsFn = createServerFn({ method: "GET" })
  .validator(cursorPaginationSchema.extend({ groupId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireActiveGroupMember(getDb(), data.groupId, user.id);
    return listGroupPosts(getDb(), {
      groupId: data.groupId,
      cursor: data.cursor,
      limit: data.limit,
      viewerId: user.id,
    });
  });

export const createGroupPostFn = createServerFn({ method: "POST" })
  .validator(createPostSchema.extend({ groupId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireActiveGroupMember(getDb(), data.groupId, user.id);
    return createPost(getDb(), {
      authorId: user.id,
      body: data.body,
      category: data.category,
      contextType: "group",
      contextId: data.groupId,
    });
  });
