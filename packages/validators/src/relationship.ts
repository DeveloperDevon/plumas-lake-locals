import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Canonical relationship types (FR-REL-01). The PRD's own example SQL enum omitted `child`,
 * `grandchild` and `niece_nephew`, which its prose requirement list includes — this array is
 * the single source of truth both `@plumas/db`'s pgEnum and the UI are generated from, so the
 * two can never drift apart the way the source PRD did.
 */
export const relationshipTypes = [
  "spouse",
  "partner",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "grandchild",
  "aunt_uncle",
  "niece_nephew",
  "cousin",
  "in_law",
  "friend",
] as const;

export type RelationshipType = (typeof relationshipTypes)[number];

export const relationshipTypeSchema = z.enum(relationshipTypes);

export const relationshipStatuses = ["pending", "accepted"] as const;
export type RelationshipStatus = (typeof relationshipStatuses)[number];
export const relationshipStatusSchema = z.enum(relationshipStatuses);

export const relationshipRequestSchema = z.object({
  toUserId: uuidSchema,
  type: relationshipTypeSchema,
});
export type RelationshipRequestInput = z.infer<typeof relationshipRequestSchema>;

/**
 * FR-REL-03: the inverse label is derived, never stored as a second row. Asymmetric pairs
 * (parent/child, grandparent/grandchild, aunt_uncle/niece_nephew) map to their counterpart;
 * symmetric types (spouse, sibling, friend, ...) map to themselves.
 */
const inverseByType: Record<RelationshipType, RelationshipType> = {
  spouse: "spouse",
  partner: "partner",
  parent: "child",
  child: "parent",
  sibling: "sibling",
  grandparent: "grandchild",
  grandchild: "grandparent",
  aunt_uncle: "niece_nephew",
  niece_nephew: "aunt_uncle",
  cousin: "cousin",
  in_law: "in_law",
  friend: "friend",
};

export function inverseRelationshipType(type: RelationshipType): RelationshipType {
  return inverseByType[type];
}
