import { z } from "zod";

import { emailSchema } from "./common";

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
});
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;
