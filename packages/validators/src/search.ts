import { z } from "zod";

/** FR-FEED-08. Field name `query` matches dm.ts's searchMembersSchema precedent. */
export const searchSchema = z.object({ query: z.string().trim().min(1).max(100) });
export type SearchInput = z.infer<typeof searchSchema>;
