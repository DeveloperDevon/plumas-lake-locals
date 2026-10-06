import { z } from "zod";

import { emailSchema } from "./common";

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;

/** Matches Better Auth's own default minimum (`emailAndPassword.minPasswordLength`). */
export const passwordSchema = z.string().min(8).max(128);

export const signInPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});
export type SignInPasswordInput = z.infer<typeof signInPasswordSchema>;
