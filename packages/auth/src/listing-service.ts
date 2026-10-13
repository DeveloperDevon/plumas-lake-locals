import { type Database, schema } from "@plumas/db";
import type {
  ListingCategory,
  ListingKind,
  ListingPriceUnit,
  ListingType,
} from "@plumas/validators";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";

import { requireManager } from "./business-service";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentReplyDepthError,
  notifyAboutComment,
} from "./comment-service";
import { writeAuditLog } from "./moderation-service";

const { businesses, comments, listings, media, users } = schema;

export class ListingNotFoundError extends Error {
  constructor(message = "That listing no longer exists.") {
    super(message);
  }
}

export class ListingForbiddenError extends Error {
  constructor(message = "You can't do that to this listing.") {
    super(message);
  }
}

export async function requireListingSeller(
  database: Database,
  listingId: string,
  actingUserId: string,
) {
  const [listing] = await database.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new ListingNotFoundError();
  if (listing.sellerId !== actingUserId) {
    throw new ListingForbiddenError("Only this listing's seller can do that.");
  }
  return listing;
}

async function requireAdmin(database: Database, actingUserId: string) {
  const [actingUser] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (actingUser?.role !== "admin") throw new ListingForbiddenError("Admins only.");
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreateListingInput {
  sellerId: string;
  kind: ListingKind;
  type: ListingType;
  title: string;
  description?: string | undefined;
  category: ListingCategory;
  condition?: string | undefined;
  priceCents?: number | undefined;
  priceUnit?: ListingPriceUnit | undefined;
  area?: string | undefined;
  businessId?: string | undefined;
}

/** FR-MKT-01/02/11/14: Free locks price to $0; a business-attributed listing needs manager access, same check business-service.ts's own posting flow already uses. */
export async function createListing(database: Database, input: CreateListingInput) {
  if (input.businessId) {
    await requireManager(database, input.businessId, input.sellerId);
  }

  const free = input.type === "free";
  const [row] = await database
    .insert(listings)
    .values({
      sellerId: input.sellerId,
      businessId: input.businessId ?? null,
      kind: input.kind,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      condition: input.kind === "item" ? (input.condition ?? null) : null,
      priceCents: free ? 0 : (input.priceCents ?? null),
      priceUnit: free ? null : (input.priceUnit ?? null),
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    })
    .returning();
  if (!row) throw new Error("Failed to create listing");
  return row;
}

export interface ListingPhoto {
  id: string;
  r2Key: string;
  width: number;
  height: number;
  altText: string | null;
}

export interface ListingView {
  id: string;
  kind: ListingKind;
  type: ListingType;
  title: string;
  description: string | null;
  category: ListingCategory;
  condition: string | null;
  priceCents: number | null;
  priceUnit: ListingPriceUnit | null;
  status: "available" | "pending" | "closed" | "expired";
  expiresAt: Date;
  createdAt: Date;
  sellerId: string;
  sellerDisplayName: string;
  sellerAvatarKey: string | null;
  businessId: string | null;
  businessName: string | null;
  businessSlug: string | null;
  photos: ListingPhoto[];
}

async function attachListingPhotos(
  database: Database,
  listingIds: readonly string[],
): Promise<Map<string, ListingPhoto[]>> {
  const map = new Map<string, ListingPhoto[]>();
  if (listingIds.length === 0) return map;

  const rows = await database
    .select()
    .from(media)
    .where(inArray(media.listingId, [...listingIds]))
    .orderBy(asc(media.createdAt));

  for (const row of rows) {
    if (!row.listingId) continue;
    const list = map.get(row.listingId) ?? [];
    list.push({
      id: row.id,
      r2Key: row.r2Key,
      width: row.width ?? 0,
      height: row.height ?? 0,
      altText: row.altText,
    });
    map.set(row.listingId, list);
  }
  return map;
}

export async function getListingById(
  database: Database,
  listingId: string,
): Promise<ListingView | null> {
  const [row] = await database
    .select({
      id: listings.id,
      kind: listings.kind,
      type: listings.type,
      title: listings.title,
      description: listings.description,
      category: listings.category,
      condition: listings.condition,
      priceCents: listings.priceCents,
      priceUnit: listings.priceUnit,
      status: listings.status,
      expiresAt: listings.expiresAt,
      createdAt: listings.createdAt,
      sellerId: listings.sellerId,
      businessId: listings.businessId,
      sellerDisplayName: users.displayName,
      sellerAvatarKey: users.avatarKey,
    })
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(eq(listings.id, listingId));
  if (!row) return null;

  let businessName: string | null = null;
  let businessSlug: string | null = null;
  if (row.businessId) {
    const [business] = await database
      .select({ name: businesses.name, slug: businesses.slug })
      .from(businesses)
      .where(eq(businesses.id, row.businessId));
    businessName = business?.name ?? null;
    businessSlug = business?.slug ?? null;
  }

  const photosByListing = await attachListingPhotos(database, [listingId]);
  return {
    ...row,
    category: row.category as ListingCategory,
    businessName,
    businessSlug,
    photos: photosByListing.get(listingId) ?? [],
  };
}

export interface ListingSummary {
  id: string;
  kind: ListingKind;
  type: ListingType;
  title: string;
  category: ListingCategory;
  priceCents: number | null;
  priceUnit: ListingPriceUnit | null;
  status: "available" | "pending" | "closed" | "expired";
  businessId: string | null;
  businessName: string | null;
  coverKey: string | null;
}

export interface ListListingsInput {
  kind?: ListingKind | undefined;
  type?: ListingType | undefined;
  category?: ListingCategory | undefined;
  condition?: string | undefined;
  minPriceCents?: number | undefined;
  maxPriceCents?: number | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface ListingsPage {
  items: ListingSummary[];
  nextCursor: string | null;
}

/**
 * FR-MKT-03/04/05/06: default browse - available and not yet expired. Nothing ever flips
 * `status` to "expired" (no scheduled-job infra exists in this monorepo, same gap task #26
 * noted for the calendar) - filtering on `expiresAt > now` gets the same user-visible effect
 * without it: an expired listing just stops appearing.
 */
export async function listListings(
  database: Database,
  input: ListListingsInput,
): Promise<ListingsPage> {
  const now = new Date();
  const conditions = [eq(listings.status, "available"), gt(listings.expiresAt, now)];
  if (input.kind) conditions.push(eq(listings.kind, input.kind));
  if (input.type) conditions.push(eq(listings.type, input.type));
  if (input.category) conditions.push(eq(listings.category, input.category));
  if (input.condition) conditions.push(eq(listings.condition, input.condition));
  if (input.minPriceCents !== undefined)
    conditions.push(gte(listings.priceCents, input.minPriceCents));
  if (input.maxPriceCents !== undefined)
    conditions.push(lte(listings.priceCents, input.maxPriceCents));
  if (input.cursor) conditions.push(lt(listings.createdAt, new Date(input.cursor)));

  const rows = await database
    .select()
    .from(listings)
    .where(and(...conditions))
    .orderBy(desc(listings.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = page[page.length - 1];

  const businessIds = [
    ...new Set(
      page
        .filter((row): row is typeof row & { businessId: string } => Boolean(row.businessId))
        .map((row) => row.businessId),
    ),
  ];
  const businessRows =
    businessIds.length > 0
      ? await database
          .select({ id: businesses.id, name: businesses.name })
          .from(businesses)
          .where(inArray(businesses.id, businessIds))
      : [];
  const businessById = new Map(businessRows.map((business) => [business.id, business.name]));

  const coverRows =
    page.length > 0
      ? await database
          .select()
          .from(media)
          .where(
            inArray(
              media.listingId,
              page.map((row) => row.id),
            ),
          )
          .orderBy(asc(media.createdAt))
      : [];
  const coverByListing = new Map<string, string>();
  for (const row of coverRows) {
    if (row.listingId && !coverByListing.has(row.listingId))
      coverByListing.set(row.listingId, row.r2Key);
  }

  return {
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      type: row.type,
      title: row.title,
      category: row.category as ListingCategory,
      priceCents: row.priceCents,
      priceUnit: row.priceUnit,
      status: row.status,
      businessId: row.businessId,
      businessName: row.businessId ? (businessById.get(row.businessId) ?? null) : null,
      coverKey: coverByListing.get(row.id) ?? null,
    })),
    nextCursor: hasMore && lastRow ? lastRow.createdAt.toISOString() : null,
  };
}

/** FR-MKT-13: every status, for the seller's own "My Listings" page - no expiry/status filtering. */
export async function listMyListings(
  database: Database,
  sellerId: string,
): Promise<ListingSummary[]> {
  const rows = await database
    .select()
    .from(listings)
    .where(eq(listings.sellerId, sellerId))
    .orderBy(desc(listings.createdAt));
  if (rows.length === 0) return [];

  const coverRows = await database
    .select()
    .from(media)
    .where(
      inArray(
        media.listingId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(media.createdAt));
  const coverByListing = new Map<string, string>();
  for (const row of coverRows) {
    if (row.listingId && !coverByListing.has(row.listingId))
      coverByListing.set(row.listingId, row.r2Key);
  }

  const businessIds = [
    ...new Set(
      rows
        .filter((row): row is typeof row & { businessId: string } => Boolean(row.businessId))
        .map((row) => row.businessId),
    ),
  ];
  const businessRows =
    businessIds.length > 0
      ? await database
          .select({ id: businesses.id, name: businesses.name })
          .from(businesses)
          .where(inArray(businesses.id, businessIds))
      : [];
  const businessById = new Map(businessRows.map((business) => [business.id, business.name]));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    type: row.type,
    title: row.title,
    category: row.category as ListingCategory,
    priceCents: row.priceCents,
    priceUnit: row.priceUnit,
    status: row.status,
    businessId: row.businessId,
    businessName: row.businessId ? (businessById.get(row.businessId) ?? null) : null,
    coverKey: coverByListing.get(row.id) ?? null,
  }));
}

export interface UpdateListingInput {
  listingId: string;
  actingUserId: string;
  kind: ListingKind;
  type: ListingType;
  title: string;
  description?: string | undefined;
  category: ListingCategory;
  condition?: string | undefined;
  priceCents?: number | undefined;
  priceUnit?: ListingPriceUnit | undefined;
  area?: string | undefined;
}

/** FR-MKT-13: seller-only. */
export async function updateListing(database: Database, input: UpdateListingInput) {
  await requireListingSeller(database, input.listingId, input.actingUserId);
  const free = input.type === "free";
  const [row] = await database
    .update(listings)
    .set({
      kind: input.kind,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      condition: input.kind === "item" ? (input.condition ?? null) : null,
      priceCents: free ? 0 : (input.priceCents ?? null),
      priceUnit: free ? null : (input.priceUnit ?? null),
    })
    .where(eq(listings.id, input.listingId))
    .returning();
  if (!row) throw new ListingNotFoundError();
  return { ...row, category: row.category as ListingCategory };
}

/** FR-MKT-06: seller sets Available/Pending/Closed directly - no admin override needed, this never deletes anything. */
export async function setListingStatus(
  database: Database,
  listingId: string,
  actingUserId: string,
  status: "available" | "pending" | "closed",
) {
  await requireListingSeller(database, listingId, actingUserId);
  const [row] = await database
    .update(listings)
    .set({ status })
    .where(eq(listings.id, listingId))
    .returning();
  if (!row) throw new ListingNotFoundError();
  return row;
}

/** FR-MKT-13: bumps expiresAt 30 days from now - a plain mutation, not tied to the (deferred) auto-expiry reminder job. */
export async function renewListing(database: Database, listingId: string, actingUserId: string) {
  await requireListingSeller(database, listingId, actingUserId);
  const [row] = await database
    .update(listings)
    .set({ expiresAt: new Date(Date.now() + THIRTY_DAYS_MS) })
    .where(eq(listings.id, listingId))
    .returning();
  if (!row) throw new ListingNotFoundError();
  return row;
}

/** FR-MKT-13/FR-MKT-12: the seller can delete their own listing; a site admin can delete anyone's (audited). Hard delete - listings have no soft-delete/edit-history concern, same precedent as task #26's events; photos cascade via the media FK. */
export async function deleteListing(database: Database, listingId: string, actingUserId: string) {
  const [existing] = await database.select().from(listings).where(eq(listings.id, listingId));
  if (!existing) throw new ListingNotFoundError();

  if (existing.sellerId !== actingUserId) {
    await requireAdmin(database, actingUserId);
    await database.delete(listings).where(eq(listings.id, listingId));
    await writeAuditLog(database, {
      action: "delete_listing",
      targetType: "listing",
      targetId: listingId,
      actorId: actingUserId,
    });
    return;
  }

  await database.delete(listings).where(eq(listings.id, listingId));
}

// ---- Comments (FR-MKT-08) - event-service.ts's own comment siblings mirrored again, this
// time for "listing"; updateComment/deleteComment from comment-service.ts are reused unchanged
// since they're keyed only by commentId. ----

export interface ListingCommentItem {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
}

export async function listCommentsForListing(
  database: Database,
  listingId: string,
): Promise<ListingCommentItem[]> {
  return database
    .select({
      id: comments.id,
      body: comments.body,
      parentId: comments.parentId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      authorId: comments.userId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.targetType, "listing"), eq(comments.targetId, listingId)))
    .orderBy(asc(comments.createdAt));
}

export async function countCommentsForListings(
  database: Database,
  listingIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (listingIds.length === 0) return map;

  const rows = await database
    .select({ targetId: comments.targetId })
    .from(comments)
    .where(and(eq(comments.targetType, "listing"), inArray(comments.targetId, [...listingIds])));

  for (const row of rows) map.set(row.targetId, (map.get(row.targetId) ?? 0) + 1);
  return map;
}

export interface CreateListingCommentInput {
  listingId: string;
  userId: string;
  body: string;
  parentId?: string | undefined;
}

export async function createListingComment(database: Database, input: CreateListingCommentInput) {
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const [parent] = await database.select().from(comments).where(eq(comments.id, input.parentId));
    if (
      parent?.targetType !== "listing" ||
      parent.targetId !== input.listingId ||
      parent.deletedAt
    ) {
      throw new CommentNotFoundError("The comment you're replying to no longer exists.");
    }
    if (parent.parentId) throw new CommentReplyDepthError();
    parentAuthorId = parent.userId;
  }

  const [row] = await database
    .insert(comments)
    .values({
      targetType: "listing",
      targetId: input.listingId,
      userId: input.userId,
      parentId: input.parentId ?? null,
      body: input.body,
    })
    .returning();
  if (!row) throw new Error("Failed to create comment");

  const [listing] = await database
    .select({ sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, input.listingId));

  await notifyAboutComment(database, {
    targetType: "listing",
    targetId: input.listingId,
    ownerId: listing?.sellerId ?? null,
    commenterId: input.userId,
    parentAuthorId,
    body: input.body,
  });

  return row;
}

// Re-exported so callers only need to import from listing-service.ts for the whole comment flow.
export { CommentForbiddenError, CommentNotFoundError, CommentReplyDepthError };
