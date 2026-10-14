import { type Database, schema } from "@plumas/db";
import { and, eq, or } from "drizzle-orm";

const { blocks, users } = schema;

/** FR-MOD-03. Idempotent - re-blocking someone already blocked is a no-op, not an error. */
export async function blockUser(
  database: Database,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  await database.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
}

export async function unblockUser(
  database: Database,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  await database
    .delete(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
}

/** The shared primitive every action-gate (comment, relationship request, DM) calls - one query, either direction. */
export async function isBlockedEitherWay(
  database: Database,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const rows = await database
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, userIdA), eq(blocks.blockedId, userIdB)),
        and(eq(blocks.blockerId, userIdB), eq(blocks.blockedId, userIdA)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface BlockedUserSummary {
  id: string;
  displayName: string;
  avatarKey: string | null;
}

/** For Settings > Blocked - who this viewer has blocked (not who has blocked them). */
export async function listBlockedUsers(
  database: Database,
  userId: string,
): Promise<BlockedUserSummary[]> {
  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(eq(blocks.blockerId, userId));
}

/**
 * The shared primitive every list/search filter calls - every id blocked by OR blocking the
 * viewer, in one query (same "batch lookup, never N+1" discipline as event-service.ts's
 * filterVisibleEventRows).
 */
export async function getBlockedUserIdSet(
  database: Database,
  viewerId: string,
): Promise<Set<string>> {
  const rows = await database
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId)));

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
  }
  return ids;
}
