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
 * FR-PRO-05. "connections" can't be properly enforced until relationships ship (task #19) -
 * until then, @plumas/auth's getProfile treats every non-owner viewer as not connected, so a
 * "connections" field is hidden from everyone but its owner rather than over-exposed.
 */
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
});
export type UserProfileInput = z.infer<typeof userProfileSchema>;
