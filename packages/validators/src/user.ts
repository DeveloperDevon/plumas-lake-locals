import { z } from "zod";

export const displayNameSchema = z.string().trim().min(1, "Enter a display name").max(80);

export const bioSchema = z.string().trim().max(500);

/** FR-INV-11: an 18+ attestation checkbox is required; no date of birth is ever collected. */
export const ageAttestationSchema = z.object({
  isAdult: z.boolean().refine((value) => value, {
    message: "You must confirm you are 18 or older",
  }),
});
export type AgeAttestationInput = z.infer<typeof ageAttestationSchema>;

// FR-PRO-01: always visible, never covered by fieldVisibility below.
export const streetSchema = z.string().trim().max(200);

// FR-PRO-02: optional fields, each covered by fieldVisibility.
export const interestsSchema = z.array(z.string().trim().min(1).max(30)).max(10);
export const occupationSchema = z.string().trim().max(100);
export const petsSchema = z.string().trim().max(100);
export const websiteSchema = z.string().trim().max(300);
export const birthdayMonthSchema = z.number().int().min(1).max(12);
export const birthdayDaySchema = z.number().int().min(1).max(31);

/**
 * FR-REL-03: used only to pick the gendered word in a relationship label (Son/Daughter,
 * Mother/Father, ...) shown on someone else's profile - not a general identity field.
 * "neutral" falls back to the ungendered term (Child, Parent, Sibling, ...).
 */
export const relationshipLabelGenderValues = ["masculine", "feminine", "neutral"] as const;
export type RelationshipLabelGender = (typeof relationshipLabelGenderValues)[number];
export const relationshipLabelGenderSchema = z.enum(relationshipLabelGenderValues);

// FR-PRO-05.
export const profileVisibilityValues = ["all", "connections"] as const;
export type ProfileVisibility = (typeof profileVisibilityValues)[number];
export const profileVisibilitySchema = z.enum(profileVisibilityValues);

export const fieldVisibilitySchema = z.object({
  interests: profileVisibilitySchema.optional(),
  occupation: profileVisibilitySchema.optional(),
  pets: profileVisibilitySchema.optional(),
  website: profileVisibilitySchema.optional(),
  birthday: profileVisibilitySchema.optional(),
});
export type FieldVisibility = z.infer<typeof fieldVisibilitySchema>;

export const userProfileSchema = z.object({
  displayName: displayNameSchema,
  bio: bioSchema.optional(),
  street: streetSchema.optional(),
  interests: interestsSchema.optional(),
  occupation: occupationSchema.optional(),
  pets: petsSchema.optional(),
  website: websiteSchema.optional(),
  birthdayMonth: birthdayMonthSchema.nullable().optional(),
  birthdayDay: birthdayDaySchema.nullable().optional(),
  fieldVisibility: fieldVisibilitySchema.optional(),
  relationshipLabelGender: relationshipLabelGenderSchema.optional(),
});
export type UserProfileInput = z.infer<typeof userProfileSchema>;
