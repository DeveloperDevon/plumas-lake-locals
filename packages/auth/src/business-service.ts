import { type Database, schema } from "@plumas/db";
import { and, desc, eq, ilike, isNull, lt, notInArray } from "drizzle-orm";

import { writeAuditLog } from "./moderation-service";

const { businessManagers, businesses, users } = schema;

export class BusinessNotFoundError extends Error {
  constructor(message = "That business page no longer exists.") {
    super(message);
  }
}

export class BusinessForbiddenError extends Error {
  constructor(message = "You can't do that on this business page.") {
    super(message);
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "business";
}

async function uniqueSlug(database: Database, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 0;
  for (;;) {
    const [existing] = await database
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, candidate));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix.toString()}`;
  }
}

async function requireAdmin(database: Database, actingUserId: string) {
  const [actingUser] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (actingUser?.role !== "admin") throw new BusinessForbiddenError("Admins only.");
}

async function getManagerRole(
  database: Database,
  businessId: string,
  userId: string,
): Promise<"owner" | "manager" | null> {
  const [row] = await database
    .select({ role: businessManagers.role })
    .from(businessManagers)
    .where(and(eq(businessManagers.businessId, businessId), eq(businessManagers.userId, userId)));
  return row?.role ?? null;
}

export async function requireManager(database: Database, businessId: string, actingUserId: string) {
  const role = await getManagerRole(database, businessId, actingUserId);
  if (!role) throw new BusinessForbiddenError("Only this page's managers can do that.");
  return role;
}

async function requireOwner(database: Database, businessId: string, actingUserId: string) {
  const role = await getManagerRole(database, businessId, actingUserId);
  if (role !== "owner") throw new BusinessForbiddenError("Only this page's owner can do that.");
}

export interface CreateBusinessInput {
  ownerId: string;
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  serviceArea: string;
  hours?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
}

// drizzle types the jsonb `hours` column as `unknown`; every caller actually stores (and
// expects back) the single free-text string described in business.ts's hoursSchema.
function withTypedHours<T extends { hours: unknown }>(
  row: T,
): Omit<T, "hours"> & { hours: string | null } {
  return { ...row, hours: row.hours as string | null };
}

/** FR-BIZ-01: the creator becomes the page's owner, the first manager. */
export async function createBusiness(database: Database, input: CreateBusinessInput) {
  const slug = await uniqueSlug(database, input.name);
  const [row] = await database
    .insert(businesses)
    .values({
      slug,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      serviceArea: input.serviceArea,
      hours: input.hours ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create business");

  await database.insert(businessManagers).values({
    businessId: row.id,
    userId: input.ownerId,
    role: "owner",
  });

  return withTypedHours(row);
}

export interface BusinessView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  logoKey: string | null;
  logoAltText: string | null;
  coverKey: string | null;
  coverAltText: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours: string | null;
  serviceArea: string;
  createdAt: Date;
  unpublishedAt: Date | null;
  myRole: "owner" | "manager" | null;
}

/**
 * FR-BIZ-09: returns null for an unpublished page if the viewer isn't a manager - the server
 * function layer turns that into a 404, same as a private group. A manager always gets it back,
 * with unpublishedAt set, so they can see the "Unpublished by an admin" banner.
 */
export async function getBusinessBySlug(
  database: Database,
  slug: string,
  viewerId: string,
): Promise<BusinessView | null> {
  const [row] = await database.select().from(businesses).where(eq(businesses.slug, slug));
  if (!row) return null;

  const myRole = await getManagerRole(database, row.id, viewerId);
  if (row.unpublishedAt && !myRole) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    logoKey: row.logoKey,
    logoAltText: row.logoAltText,
    coverKey: row.coverKey,
    coverAltText: row.coverAltText,
    phone: row.phone,
    email: row.email,
    website: row.website,
    hours: row.hours as string | null,
    serviceArea: row.serviceArea,
    createdAt: row.createdAt,
    unpublishedAt: row.unpublishedAt,
    myRole,
  };
}

export interface ListBusinessesInput {
  search?: string | undefined;
  category?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface BusinessSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  logoKey: string | null;
  createdAt: Date;
}

export interface BusinessesPage {
  items: BusinessSummary[];
  nextCursor: string | null;
}

/** FR-BIZ-06: the directory - unpublished pages never appear. */
export async function listBusinesses(
  database: Database,
  input: ListBusinessesInput,
): Promise<BusinessesPage> {
  const conditions = [isNull(businesses.unpublishedAt)];
  if (input.search) conditions.push(ilike(businesses.name, `%${input.search}%`));
  if (input.category) conditions.push(eq(businesses.category, input.category));
  if (input.cursor) conditions.push(lt(businesses.createdAt, new Date(input.cursor)));

  const rows = await database
    .select()
    .from(businesses)
    .where(and(...conditions))
    .orderBy(desc(businesses.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      logoKey: row.logoKey,
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore && lastRow ? lastRow.createdAt.toISOString() : null,
  };
}

/** Businesses the user manages - for the directory's "My businesses" and a profile card. */
export async function listBusinessesForUser(
  database: Database,
  userId: string,
): Promise<BusinessSummary[]> {
  const rows = await database
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      description: businesses.description,
      category: businesses.category,
      logoKey: businesses.logoKey,
      createdAt: businesses.createdAt,
    })
    .from(businessManagers)
    .innerJoin(businesses, eq(businesses.id, businessManagers.businessId))
    .where(eq(businessManagers.userId, userId))
    .orderBy(desc(businesses.createdAt));
  return rows;
}

export interface UpdateBusinessInput {
  businessId: string;
  actingUserId: string;
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  serviceArea: string;
  hours?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
}

/** FR-BIZ-01: manager-only. */
export async function updateBusiness(database: Database, input: UpdateBusinessInput) {
  await requireManager(database, input.businessId, input.actingUserId);
  const [row] = await database
    .update(businesses)
    .set({
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      serviceArea: input.serviceArea,
      hours: input.hours ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
    })
    .where(eq(businesses.id, input.businessId))
    .returning();
  if (!row) throw new BusinessNotFoundError();
  return withTypedHours(row);
}

export interface BusinessManagerView {
  userId: string;
  displayName: string;
  avatarKey: string | null;
  role: "owner" | "manager";
}

export async function listManagers(
  database: Database,
  businessId: string,
): Promise<BusinessManagerView[]> {
  return database
    .select({
      userId: users.id,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      role: businessManagers.role,
    })
    .from(businessManagers)
    .innerJoin(users, eq(users.id, businessManagers.userId))
    .where(eq(businessManagers.businessId, businessId))
    .orderBy(businessManagers.createdAt);
}

/** FR-BIZ-04: owner-only. Idempotent if already a manager. */
export async function addManager(
  database: Database,
  businessId: string,
  targetUserId: string,
  actingUserId: string,
) {
  await requireOwner(database, businessId, actingUserId);

  const existing = await getManagerRole(database, businessId, targetUserId);
  if (existing) return;

  await database
    .insert(businessManagers)
    .values({ businessId, userId: targetUserId, role: "manager" });
}

/** Member search for the add-manager box - existing managers are excluded. */
export async function searchAddableManagers(database: Database, businessId: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const existingRows = await database
    .select({ userId: businessManagers.userId })
    .from(businessManagers)
    .where(eq(businessManagers.businessId, businessId));
  const existingIds = existingRows.map((row) => row.userId);

  const conditions = [ilike(users.displayName, `%${trimmed}%`), eq(users.status, "active")];
  if (existingIds.length > 0) conditions.push(notInArray(users.id, existingIds));

  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(and(...conditions))
    .limit(20);
}

/** FR-BIZ-09: site-admin only - hides the page from the directory and non-managers. */
export async function unpublishBusiness(
  database: Database,
  businessId: string,
  actingAdminId: string,
) {
  await requireAdmin(database, actingAdminId);
  const [row] = await database
    .update(businesses)
    .set({ unpublishedAt: new Date() })
    .where(eq(businesses.id, businessId))
    .returning();
  if (!row) throw new BusinessNotFoundError();

  await writeAuditLog(database, {
    action: "unpublish_business",
    targetType: "business",
    targetId: businessId,
    actorId: actingAdminId,
  });
  return row;
}

export async function republishBusiness(
  database: Database,
  businessId: string,
  actingAdminId: string,
) {
  await requireAdmin(database, actingAdminId);
  const [row] = await database
    .update(businesses)
    .set({ unpublishedAt: null })
    .where(eq(businesses.id, businessId))
    .returning();
  if (!row) throw new BusinessNotFoundError();

  await writeAuditLog(database, {
    action: "republish_business",
    targetType: "business",
    targetId: businessId,
    actorId: actingAdminId,
  });
  return row;
}
