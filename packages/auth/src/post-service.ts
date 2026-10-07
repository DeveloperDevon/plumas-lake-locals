import { type Database, schema } from "@plumas/db";
import type { PostCategory } from "@plumas/validators";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";

const { media, posts, users } = schema;

export class PostNotFoundError extends Error {
  constructor(message = "That post no longer exists.") {
    super(message);
  }
}

export class PostForbiddenError extends Error {
  constructor(message = "You can't do that to this post.") {
    super(message);
  }
}

export class PostPinLimitError extends Error {
  constructor() {
    super("Only 3 posts can be pinned at a time. Unpin one first.");
  }
}

const MAX_PINNED_POSTS = 3;

export interface PostMediaItem {
  id: string;
  r2Key: string;
  width: number;
  height: number;
}

export interface FeedPost {
  id: string;
  body: string;
  category: PostCategory | null;
  pinnedAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
  media: PostMediaItem[];
}

async function attachMedia(
  database: Database,
  rows: readonly { id: string }[],
): Promise<Map<string, PostMediaItem[]>> {
  const map = new Map<string, PostMediaItem[]>();
  if (rows.length === 0) return map;

  const mediaRows = await database
    .select()
    .from(media)
    .where(
      inArray(
        media.postId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(media.createdAt);

  for (const row of mediaRows) {
    if (!row.postId) continue;
    const list = map.get(row.postId) ?? [];
    list.push({ id: row.id, r2Key: row.r2Key, width: row.width ?? 0, height: row.height ?? 0 });
    map.set(row.postId, list);
  }
  return map;
}

function toFeedPost(
  row: {
    id: string;
    body: string;
    category: string | null;
    pinnedAt: Date | null;
    createdAt: Date;
    editedAt: Date | null;
    authorId: string;
    authorDisplayName: string;
    authorAvatarKey: string | null;
  },
  mediaMap: Map<string, PostMediaItem[]>,
): FeedPost {
  return {
    ...row,
    category: row.category as PostCategory | null,
    media: mediaMap.get(row.id) ?? [],
  };
}

export interface CreatePostInput {
  authorId: string;
  body: string;
  category?: PostCategory | undefined;
}

export async function createPost(database: Database, input: CreatePostInput) {
  const [row] = await database
    .insert(posts)
    .values({
      authorId: input.authorId,
      contextType: "feed",
      body: input.body,
      category: input.category ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create post");
  return row;
}

export interface UpdatePostInput {
  postId: string;
  authorId: string;
  body: string;
  category?: PostCategory | undefined;
}

/** Only the post's own author may edit it - enforced here, not just the client hiding the button. */
export async function updatePost(database: Database, input: UpdatePostInput) {
  const [existing] = await database.select().from(posts).where(eq(posts.id, input.postId));
  if (!existing || existing.deletedAt) throw new PostNotFoundError();
  if (existing.authorId !== input.authorId) throw new PostForbiddenError();

  const [row] = await database
    .update(posts)
    .set({ body: input.body, category: input.category ?? null, editedAt: new Date() })
    .where(eq(posts.id, input.postId))
    .returning();
  if (!row) throw new Error("Failed to update post");
  return row;
}

/** Only the post's own author may delete it. Soft delete - the row stays, deletedAt is stamped. */
export async function deletePost(database: Database, postId: string, authorId: string) {
  const [existing] = await database.select().from(posts).where(eq(posts.id, postId));
  if (!existing || existing.deletedAt) throw new PostNotFoundError();
  if (existing.authorId !== authorId) throw new PostForbiddenError();

  await database.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
}

/** Verifies the caller both owns the post and hasn't hit the 10-image cap - the upload route's own checks. */
export async function getOwnedPost(database: Database, postId: string, authorId: string) {
  const [existing] = await database.select().from(posts).where(eq(posts.id, postId));
  if (!existing || existing.deletedAt) throw new PostNotFoundError();
  if (existing.authorId !== authorId) throw new PostForbiddenError();
  return existing;
}

export interface ListFeedPostsInput {
  cursor?: string | undefined;
  limit: number;
}

export interface FeedPage {
  items: FeedPost[];
  nextCursor: string | null;
}

/** FR-FEED-02: reverse-chronological, cursor-paginated. Pinned posts are excluded here - they're a separate query, only prepended on the first page. */
export async function listFeedPosts(
  database: Database,
  { cursor, limit }: ListFeedPostsInput,
): Promise<FeedPage> {
  const conditions = [
    eq(posts.contextType, "feed"),
    isNull(posts.contextId),
    isNull(posts.deletedAt),
    isNull(posts.pinnedAt),
  ];
  if (cursor) conditions.push(lt(posts.createdAt, new Date(cursor)));

  const rows = await database
    .select({
      id: posts.id,
      body: posts.body,
      category: posts.category,
      pinnedAt: posts.pinnedAt,
      createdAt: posts.createdAt,
      editedAt: posts.editedAt,
      authorId: posts.authorId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const mediaMap = await attachMedia(database, page);
  const lastRow = page[page.length - 1];

  return {
    items: page.map((row) => toFeedPost(row, mediaMap)),
    nextCursor: hasMore && lastRow ? lastRow.createdAt.toISOString() : null,
  };
}

/** FR-FEED-07: at most 3, newest-pinned first. Fetched fresh every time, not paginated. */
export async function listPinnedPosts(database: Database): Promise<FeedPost[]> {
  const rows = await database
    .select({
      id: posts.id,
      body: posts.body,
      category: posts.category,
      pinnedAt: posts.pinnedAt,
      createdAt: posts.createdAt,
      editedAt: posts.editedAt,
      authorId: posts.authorId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(isNull(posts.deletedAt), isNotNull(posts.pinnedAt)))
    .orderBy(desc(posts.pinnedAt))
    .limit(MAX_PINNED_POSTS);

  const mediaMap = await attachMedia(database, rows);
  return rows.map((row) => toFeedPost(row, mediaMap));
}

async function requireAdmin(database: Database, actingUserId: string) {
  const [actingUser] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (actingUser?.role !== "admin") {
    throw new PostForbiddenError("Only admins can pin posts.");
  }
}

export async function pinPost(database: Database, postId: string, actingUserId: string) {
  await requireAdmin(database, actingUserId);

  const [existing] = await database.select().from(posts).where(eq(posts.id, postId));
  if (!existing || existing.deletedAt) throw new PostNotFoundError();
  if (existing.pinnedAt) return existing; // already pinned - idempotent, not an error

  const [pinnedCountRow] = await database
    .select({ value: count() })
    .from(posts)
    .where(isNotNull(posts.pinnedAt));
  if ((pinnedCountRow?.value ?? 0) >= MAX_PINNED_POSTS) throw new PostPinLimitError();

  const [row] = await database
    .update(posts)
    .set({ pinnedAt: new Date() })
    .where(eq(posts.id, postId))
    .returning();
  if (!row) throw new Error("Failed to pin post");
  return row;
}

export async function unpinPost(database: Database, postId: string, actingUserId: string) {
  await requireAdmin(database, actingUserId);

  const [row] = await database
    .update(posts)
    .set({ pinnedAt: null })
    .where(eq(posts.id, postId))
    .returning();
  if (!row) throw new PostNotFoundError();
  return row;
}
