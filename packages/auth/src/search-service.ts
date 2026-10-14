import { type Database, schema } from "@plumas/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

const { businesses, groupMembers, groups, posts, users } = schema;

/** How many results to overfetch before visibility-filtering posts (some get dropped). */
const POST_OVERFETCH = 30;
const RESULTS_PER_TYPE = 10;

export interface MemberSearchResult {
  id: string;
  displayName: string;
  avatarKey: string | null;
}

/**
 * FR-FEED-08. A second, ranked member search beside dm-service.ts's searchMembers - that one
 * is the DM composer's own ILIKE-on-displayName picker and is left untouched; this is the
 * unified search page's tsvector-ranked version. Same exclude-self/exclude-suspended rule.
 */
export async function searchMembersRanked(
  database: Database,
  query: string,
  viewerId: string,
): Promise<MemberSearchResult[]> {
  const tsquery = sql`plainto_tsquery('english', ${query})`;
  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(
      and(
        sql`${users.searchVector} @@ ${tsquery}`,
        eq(users.status, "active"),
        ne(users.id, viewerId),
      ),
    )
    .orderBy(sql`ts_rank(${users.searchVector}, ${tsquery}) desc`)
    .limit(RESULTS_PER_TYPE);
}

export interface GroupSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverKey: string | null;
}

/** FR-GRP-11: public only - same convention listGroups already states ("hidden from the directory, search and the calendar"). */
export async function searchGroupsRanked(
  database: Database,
  query: string,
): Promise<GroupSearchResult[]> {
  const tsquery = sql`plainto_tsquery('english', ${query})`;
  return database
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      coverKey: groups.coverKey,
    })
    .from(groups)
    .where(and(sql`${groups.searchVector} @@ ${tsquery}`, eq(groups.visibility, "public")))
    .orderBy(sql`ts_rank(${groups.searchVector}, ${tsquery}) desc`)
    .limit(RESULTS_PER_TYPE);
}

export interface BusinessSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverKey: string | null;
}

/** FR-BIZ-09: excludes unpublished, same as listBusinesses. */
export async function searchBusinessesRanked(
  database: Database,
  query: string,
): Promise<BusinessSearchResult[]> {
  const tsquery = sql`plainto_tsquery('english', ${query})`;
  return database
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      description: businesses.description,
      coverKey: businesses.coverKey,
    })
    .from(businesses)
    .where(and(sql`${businesses.searchVector} @@ ${tsquery}`, isNull(businesses.unpublishedAt)))
    .orderBy(sql`ts_rank(${businesses.searchVector}, ${tsquery}) desc`)
    .limit(RESULTS_PER_TYPE);
}

export interface PostSearchResult {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
  contextType: "feed" | "group" | "business";
  contextSlug: string | null;
}

/**
 * FR-FEED-08 + FR-GRP-11: feed-context posts are always visible; group/business-context posts
 * only if the viewer can see that board (public group or active membership; business posts are
 * excluded if their business is unpublished - a post under an unpublished business is treated
 * the same as the business itself, even for that business's own managers, a minor simplification
 * accepted for scope). Soft-deleted posts are excluded. Overfetches by rank, then
 * visibility-filters, since some ranked rows may get dropped.
 */
export async function searchPostsRanked(
  database: Database,
  query: string,
  viewerId: string,
): Promise<PostSearchResult[]> {
  const tsquery = sql`plainto_tsquery('english', ${query})`;
  const rows = await database
    .select({
      id: posts.id,
      body: posts.body,
      createdAt: posts.createdAt,
      authorId: posts.authorId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
      contextType: posts.contextType,
      contextId: posts.contextId,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(sql`${posts.searchVector} @@ ${tsquery}`, isNull(posts.deletedAt)))
    .orderBy(sql`ts_rank(${posts.searchVector}, ${tsquery}) desc`)
    .limit(POST_OVERFETCH);

  const groupIds = [
    ...new Set(
      rows
        .filter((row): row is typeof row & { contextId: string } => row.contextType === "group")
        .map((row) => row.contextId),
    ),
  ];
  const businessIds = [
    ...new Set(
      rows
        .filter((row): row is typeof row & { contextId: string } => row.contextType === "business")
        .map((row) => row.contextId),
    ),
  ];

  const [groupRows, businessRows] = await Promise.all([
    groupIds.length > 0
      ? database
          .select({ id: groups.id, slug: groups.slug, visibility: groups.visibility })
          .from(groups)
          .where(inArray(groups.id, groupIds))
      : Promise.resolve([]),
    businessIds.length > 0
      ? database
          .select({
            id: businesses.id,
            slug: businesses.slug,
            unpublishedAt: businesses.unpublishedAt,
          })
          .from(businesses)
          .where(inArray(businesses.id, businessIds))
      : Promise.resolve([]),
  ]);
  const groupById = new Map(groupRows.map((group) => [group.id, group]));
  const businessById = new Map(businessRows.map((business) => [business.id, business]));

  const privateGroupIds = groupRows
    .filter((group) => group.visibility === "private")
    .map((group) => group.id);
  const myActiveMemberships =
    privateGroupIds.length > 0
      ? await database
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(
            and(
              inArray(groupMembers.groupId, privateGroupIds),
              eq(groupMembers.userId, viewerId),
              eq(groupMembers.status, "active"),
            ),
          )
      : [];
  const visiblePrivateGroupIds = new Set(myActiveMemberships.map((row) => row.groupId));

  const visible = rows.filter((row) => {
    if (row.contextType === "feed") return true;
    if (row.contextType === "group") {
      const group = groupById.get(row.contextId ?? "");
      if (!group) return false;
      if (group.visibility !== "private") return true;
      return visiblePrivateGroupIds.has(group.id);
    }
    const business = businessById.get(row.contextId ?? "");
    return Boolean(business) && business?.unpublishedAt === null;
  });

  return visible.slice(0, RESULTS_PER_TYPE).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorAvatarKey: row.authorAvatarKey,
    contextType: row.contextType,
    contextSlug:
      row.contextType === "group"
        ? (groupById.get(row.contextId ?? "")?.slug ?? null)
        : row.contextType === "business"
          ? (businessById.get(row.contextId ?? "")?.slug ?? null)
          : null,
  }));
}
