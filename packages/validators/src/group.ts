import { z } from "zod";

import { cursorPaginationSchema, uuidSchema } from "./common";

/** FR-GRP-10/11: public groups are discoverable; private groups are invite-only and 404 for everyone else. */
export const groupVisibilities = ["public", "private"] as const;
export type GroupVisibility = (typeof groupVisibilities)[number];
export const groupVisibilitySchema = z.enum(groupVisibilities);

/** FR-GRP-07: owner can transfer ownership; admins share owner's moderation powers over the group. */
export const groupMemberRoles = ["owner", "admin", "member"] as const;
export type GroupMemberRole = (typeof groupMemberRoles)[number];
export const groupMemberRoleSchema = z.enum(groupMemberRoles);

/**
 * FR-GRP-04/05: "requested" is a member-initiated join request awaiting owner/admin approval;
 * "invited" is an owner/admin-initiated invite awaiting the invitee's accept/decline (skips
 * approval, but still requires the invitee's own action); "active" is a full member either way.
 */
export const groupMemberStatuses = ["requested", "invited", "active"] as const;
export type GroupMemberStatus = (typeof groupMemberStatuses)[number];
export const groupMemberStatusSchema = z.enum(groupMemberStatuses);

export const groupNameSchema = z.string().trim().min(1).max(100);
export const groupDescriptionSchema = z.string().trim().max(2000);
export const groupCategorySchema = z.string().trim().max(50);

export const createGroupSchema = z.object({
  name: groupNameSchema,
  description: groupDescriptionSchema.optional(),
  category: groupCategorySchema.optional(),
  visibility: groupVisibilitySchema.default("public"),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  groupId: uuidSchema,
  name: groupNameSchema,
  description: groupDescriptionSchema.optional(),
  category: groupCategorySchema.optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const updateGroupVisibilitySchema = z.object({
  groupId: uuidSchema,
  visibility: groupVisibilitySchema,
});
export type UpdateGroupVisibilityInput = z.infer<typeof updateGroupVisibilitySchema>;

export const listGroupsSchema = cursorPaginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  category: groupCategorySchema.optional(),
});
export type ListGroupsInput = z.infer<typeof listGroupsSchema>;

export const groupIdSchema = z.object({ groupId: uuidSchema });

export const groupMemberActionSchema = z.object({
  groupId: uuidSchema,
  targetUserId: uuidSchema,
});
export type GroupMemberActionInput = z.infer<typeof groupMemberActionSchema>;

export const transferGroupOwnershipSchema = z.object({
  groupId: uuidSchema,
  newOwnerId: uuidSchema,
});
export type TransferGroupOwnershipInput = z.infer<typeof transferGroupOwnershipSchema>;
