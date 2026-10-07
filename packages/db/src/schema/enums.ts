import { relationshipStatuses, relationshipTypes, themes } from "@plumas/validators";
import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["member", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

// Generated from @plumas/validators' canonical list, same reasoning as relationshipTypeEnum
// below: the zod schema and the database enum can never drift apart.
export const themeEnum = pgEnum("theme", [...themes]);

// Generated from @plumas/validators' canonical list so the app's zod schema and the
// database enum can never drift apart (see docs/adr/0002 and the PRD discrepancy note).
export const relationshipTypeEnum = pgEnum("relationship_type", [...relationshipTypes]);
export const relationshipStatusEnum = pgEnum("relationship_status", [...relationshipStatuses]);

export const groupVisibilityEnum = pgEnum("group_visibility", ["public", "private"]);
export const groupMemberRoleEnum = pgEnum("group_member_role", ["owner", "admin", "member"]);
export const groupMemberStatusEnum = pgEnum("group_member_status", [
  "requested",
  "invited",
  "active",
]);

export const businessManagerRoleEnum = pgEnum("business_manager_role", ["owner", "manager"]);

export const postContextTypeEnum = pgEnum("post_context_type", ["feed", "group", "business"]);

export const listingKindEnum = pgEnum("listing_kind", ["item", "service"]);
export const listingTypeEnum = pgEnum("listing_type", ["sale", "free", "wanted"]);
export const listingPriceUnitEnum = pgEnum("listing_price_unit", ["fixed", "hourly", "quote"]);
export const listingStatusEnum = pgEnum("listing_status", [
  "available",
  "pending",
  "closed",
  "expired",
]);

export const conversationKindEnum = pgEnum("conversation_kind", ["direct", "group"]);
export const participantStatusEnum = pgEnum("participant_status", [
  "request",
  "active",
  "declined",
  "left",
]);

// Polymorphic target for both comments and reactions.
export const commentTargetTypeEnum = pgEnum("comment_target_type", ["post", "listing", "event"]);
export const reactionTypeEnum = pgEnum("reaction_type", [
  "like",
  "love",
  "laugh",
  "sad",
  "helpful",
]);

export const eventHostTypeEnum = pgEnum("event_host_type", ["group", "business"]);
