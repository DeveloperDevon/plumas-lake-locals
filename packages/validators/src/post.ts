import { z } from "zod";

/** FR-FEED-06: optional, fixed set per the PRD. */
export const postCategories = ["general", "lost_found", "safety", "recommendations"] as const;
export type PostCategory = (typeof postCategories)[number];
export const postCategorySchema = z.enum(postCategories);

/** FR-FEED-01: 5,000 chars. */
export const postBodySchema = z.string().trim().min(1).max(5000);

/** FR-FEED-01: up to 10 images per post. */
export const MAX_POST_IMAGES = 10;

export const createPostSchema = z.object({
  body: postBodySchema,
  category: postCategorySchema.optional(),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  postId: z.string().uuid(),
  body: postBodySchema,
  category: postCategorySchema.optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
