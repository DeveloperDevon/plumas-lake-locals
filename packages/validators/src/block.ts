import { z } from "zod";

import { uuidSchema } from "./common";

/** FR-MOD-03. */
export const blockUserSchema = z.object({ userId: uuidSchema });
export type BlockUserInput = z.infer<typeof blockUserSchema>;
