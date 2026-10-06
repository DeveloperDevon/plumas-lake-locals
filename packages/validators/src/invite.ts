import { z } from "zod";

import { passwordSchema } from "./auth";
import { emailSchema } from "./common";
import { displayNameSchema } from "./user";

/** FR-INV-05: members get a default outstanding-invite quota; admins are unlimited. */
export const DEFAULT_MEMBER_INVITE_QUOTA = 10;

/** FR-INV-02: an invite link is single-use and expires after 7 days. */
export const INVITE_EXPIRY_DAYS = 7;

export const inviteNoteSchema = z.string().trim().max(500);

export const inviteCreateSchema = z.object({
  email: emailSchema,
  note: inviteNoteSchema.optional(),
});
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

/** base64url(32 random bytes) is 43 characters; accept a little slack either side. */
export const inviteTokenSchema = z.string().min(32).max(128);

export const inviteAcceptSchema = z.object({
  token: inviteTokenSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  isAdult: z.boolean().refine((value) => value, {
    message: "You must confirm you are 18 or older",
  }),
});
export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;
