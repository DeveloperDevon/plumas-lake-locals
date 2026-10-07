import { z } from "zod";

/** FR-FEED-03: the 5 reaction types. Posts only - see docs decision in task #18's plan. */
export const reactionTypes = ["like", "love", "laugh", "sad", "helpful"] as const;
export type ReactionType = (typeof reactionTypes)[number];
export const reactionTypeSchema = z.enum(reactionTypes);

export const setReactionSchema = z.object({
  postId: z.string().uuid(),
  type: reactionTypeSchema,
});
export type SetReactionInput = z.infer<typeof setReactionSchema>;

export const removeReactionSchema = z.object({
  postId: z.string().uuid(),
});
export type RemoveReactionInput = z.infer<typeof removeReactionSchema>;
