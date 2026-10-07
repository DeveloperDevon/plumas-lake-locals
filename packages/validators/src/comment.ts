import { z } from "zod";

/** No explicit PRD limit for comments - matches the DM message cap elsewhere in the PRD as a reasonable precedent. */
export const commentBodySchema = z.string().trim().min(1).max(2000);

export const createCommentSchema = z.object({
  postId: z.string().uuid(),
  body: commentBodySchema,
  // One level of replies (FR-FEED-03) - set when replying to a top-level comment, enforced
  // server-side in comment-service.ts, not just by the UI never showing "Reply" on a reply.
  parentId: z.string().uuid().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  commentId: z.string().uuid(),
  body: commentBodySchema,
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
