import {
  addManager,
  createBusiness,
  createPost,
  getBusinessBySlug,
  listBusinesses,
  listBusinessesForUser,
  listBusinessMedia,
  listBusinessPosts,
  listManagers,
  requireManager,
  searchAddableManagers,
  updateBusiness,
} from "@plumas/auth";
import {
  addBusinessManagerSchema,
  businessIdSchema,
  createBusinessSchema,
  createPostSchema,
  cursorPaginationSchema,
  listBusinessesSchema,
  updateBusinessSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getBusinessesFn = createServerFn({ method: "GET" })
  .validator(listBusinessesSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listBusinesses(getDb(), data);
  });

export const getMyBusinessesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listBusinessesForUser(getDb(), user.id);
});

export const getBusinessesForUserFn = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listBusinessesForUser(getDb(), data.userId);
  });

/**
 * FR-BIZ-09: returns null (never throws) for an unpublished page the viewer can't see - the
 * route's own loader turns that into a 404, same reasoning as getGroupBySlugFn.
 */
export const getBusinessBySlugFn = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getBusinessBySlug(getDb(), data.slug, user.id);
  });

export const getManagersFn = createServerFn({ method: "GET" })
  .validator(businessIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listManagers(getDb(), data.businessId);
  });

export const createBusinessFn = createServerFn({ method: "POST" })
  .validator(createBusinessSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createBusiness(getDb(), { ownerId: user.id, ...data });
  });

export const updateBusinessFn = createServerFn({ method: "POST" })
  .validator(updateBusinessSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateBusiness(getDb(), { ...data, actingUserId: user.id });
  });

export const addManagerFn = createServerFn({ method: "POST" })
  .validator(addBusinessManagerSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await addManager(getDb(), data.businessId, data.targetUserId, user.id);
    return { ok: true as const };
  });

export const searchAddableManagersFn = createServerFn({ method: "GET" })
  .validator(z.object({ businessId: z.string().uuid(), query: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    return searchAddableManagers(getDb(), data.businessId, data.query);
  });

export const getBusinessMediaFn = createServerFn({ method: "GET" })
  .validator(businessIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listBusinessMedia(getDb(), data.businessId);
  });

export const getBusinessPostsFn = createServerFn({ method: "GET" })
  .validator(cursorPaginationSchema.extend({ businessId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listBusinessPosts(getDb(), {
      businessId: data.businessId,
      cursor: data.cursor,
      limit: data.limit,
      viewerId: user.id,
    });
  });

/** FR-BIZ-02: only managers can create top-level posts on a business page's board. */
export const createBusinessPostFn = createServerFn({ method: "POST" })
  .validator(createPostSchema.extend({ businessId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireManager(getDb(), data.businessId, user.id);
    return createPost(getDb(), {
      authorId: user.id,
      body: data.body,
      category: data.category,
      contextType: "business",
      contextId: data.businessId,
    });
  });
