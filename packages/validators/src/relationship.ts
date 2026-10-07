import { z } from "zod";

import { uuidSchema } from "./common";
import type { RelationshipLabelGender } from "./user";

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

export const acceptRelationshipSchema = z.object({ relationshipId: uuidSchema });
export type AcceptRelationshipInput = z.infer<typeof acceptRelationshipSchema>;

export const removeRelationshipSchema = z.object({ relationshipId: uuidSchema });
export type RemoveRelationshipInput = z.infer<typeof removeRelationshipSchema>;

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

// FR-REL-03: the neutral (gender-unknown or "neutral" preference) term for each type - also
// what the request-type picker shows, since picking a type is independent of anyone's gender.
const neutralLabels: Record<RelationshipType, string> = {
  spouse: "Spouse",
  partner: "Partner",
  parent: "Parent",
  child: "Child",
  sibling: "Sibling",
  grandparent: "Grandparent",
  grandchild: "Grandchild",
  aunt_uncle: "Aunt/Uncle",
  niece_nephew: "Niece/Nephew",
  cousin: "Cousin",
  in_law: "In-law",
  friend: "Friend",
};

// Only types with an unambiguous single-word gendered pair get one - partner/cousin/in_law/
// friend have no clean equivalent and always fall back to their neutral term.
const genderedLabels: Partial<Record<RelationshipType, Record<"masculine" | "feminine", string>>> =
  {
    spouse: { masculine: "Husband", feminine: "Wife" },
    parent: { masculine: "Father", feminine: "Mother" },
    child: { masculine: "Son", feminine: "Daughter" },
    sibling: { masculine: "Brother", feminine: "Sister" },
    grandparent: { masculine: "Grandfather", feminine: "Grandmother" },
    grandchild: { masculine: "Grandson", feminine: "Granddaughter" },
    aunt_uncle: { masculine: "Uncle", feminine: "Aunt" },
    niece_nephew: { masculine: "Nephew", feminine: "Niece" },
  };

/**
 * FR-REL-03: a relationship label always describes one specific person, gendered by that
 * person's own `relationshipLabelGender` preference - never the viewer's. Pass "neutral" for
 * the request-type picker, where there's no specific person's gender involved yet.
 */
export function relationshipLabel(type: RelationshipType, gender: RelationshipLabelGender): string {
  if (gender !== "neutral") {
    const entry = genderedLabels[type];
    if (entry) return entry[gender];
  }
  return neutralLabels[type];
}
