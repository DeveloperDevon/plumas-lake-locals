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

export const userProfileSchema = z.object({
  displayName: displayNameSchema,
  bio: bioSchema.optional(),
});
export type UserProfileInput = z.infer<typeof userProfileSchema>;
