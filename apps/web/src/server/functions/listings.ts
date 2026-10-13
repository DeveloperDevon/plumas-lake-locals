import {
  countCommentsForListings,
  createListing,
  createListingComment,
  deleteComment,
  deleteListing,
  getListingById,
  listCommentsForListing,
  listListings,
  listMyListings,
  renewListing,
  setListingStatus,
  updateComment,
  updateListing,
} from "@plumas/auth";
import {
  createListingCommentSchema,
  createListingSchema,
  listingIdSchema,
  listListingsSchema,
  setListingStatusSchema,
  updateCommentSchema,
  updateListingSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

/** Returns null (never throws) for a missing listing - the route's own loader turns that into notFound(), same reasoning as getEventByIdFn. */
export const getListingByIdFn = createServerFn({ method: "GET" })
  .validator(listingIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return getListingById(getDb(), data.listingId);
  });

export const getListingsFn = createServerFn({ method: "GET" })
  .validator(listListingsSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listListings(getDb(), data);
  });

export const getMyListingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listMyListings(getDb(), user.id);
});

export const createListingFn = createServerFn({ method: "POST" })
  .validator(createListingSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createListing(getDb(), { ...data, sellerId: user.id });
  });

export const updateListingFn = createServerFn({ method: "POST" })
  .validator(updateListingSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateListing(getDb(), { ...data, actingUserId: user.id });
  });

export const setListingStatusFn = createServerFn({ method: "POST" })
  .validator(setListingStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return setListingStatus(getDb(), data.listingId, user.id, data.status);
  });

export const renewListingFn = createServerFn({ method: "POST" })
  .validator(listingIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return renewListing(getDb(), data.listingId, user.id);
  });

export const deleteListingFn = createServerFn({ method: "POST" })
  .validator(listingIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteListing(getDb(), data.listingId, user.id);
    return { ok: true as const };
  });

export const getListingCommentsFn = createServerFn({ method: "GET" })
  .validator(listingIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listCommentsForListing(getDb(), data.listingId);
  });

export const getListingCommentCountsFn = createServerFn({ method: "GET" })
  .validator(z.object({ listingIds: z.array(z.string().uuid()) }))
  .handler(async ({ data }) => {
    await requireUser();
    const counts = await countCommentsForListings(getDb(), data.listingIds);
    return Object.fromEntries(counts);
  });

export const createListingCommentFn = createServerFn({ method: "POST" })
  .validator(createListingCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createListingComment(getDb(), { ...data, userId: user.id });
  });

export const updateListingCommentFn = createServerFn({ method: "POST" })
  .validator(updateCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateComment(getDb(), { ...data, userId: user.id });
  });

export const deleteListingCommentFn = createServerFn({ method: "POST" })
  .validator(z.object({ commentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteComment(getDb(), data.commentId, user.id);
    return { ok: true as const };
  });
