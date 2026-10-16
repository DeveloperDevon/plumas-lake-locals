import { type Database, schema } from "@plumas/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

const {
  auditLog,
  businessManagers,
  comments,
  conversations,
  devices,
  events,
  groupMembers,
  groups,
  invites,
  listings,
  media,
  messages,
  posts,
  reactions,
  reports,
  users,
} = schema;

// Reserved, never issued to a real signup - findable by email so the sentinel is created once
// and reused by every subsequent deletion, never duplicated.
export const GHOST_USER_EMAIL = "deleted-member@system.plumaslakelocals.invalid";
const GHOST_DISPLAY_NAME = "Deleted member";
// Never used for real MLS crypto - the ghost device exists purely to satisfy
// messages.senderDeviceId's FK once the real device is gone.
const GHOST_DEVICE_PLACEHOLDER_KEY = "ghost-device-no-real-key";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * `status: "suspended"` is deliberate, not an afterthought: every member-search/picker function
 * (search-service.ts, group-service.ts's searchInvitableMembers, business-service.ts's
 * searchAddableManagers, dm-service.ts's searchMembers) already filters `status = "active"`, so
 * this one choice keeps the ghost out of search/pickers with no new filtering code anywhere.
 */
async function getOrCreateGhostUser(tx: Tx) {
  const [existing] = await tx.select().from(users).where(eq(users.email, GHOST_USER_EMAIL));
  if (existing) return existing;

  await tx
    .insert(users)
    .values({ email: GHOST_USER_EMAIL, displayName: GHOST_DISPLAY_NAME, status: "suspended" })
    .onConflictDoNothing({ target: users.email });

  const [row] = await tx.select().from(users).where(eq(users.email, GHOST_USER_EMAIL));
  if (!row) throw new Error("Failed to create the ghost user for account deletion");
  return row;
}

/**
 * No unique constraint on devices.userId, so unlike the ghost user this can't use
 * onConflictDoNothing - a benign race between two concurrent first-ever deletions could create
 * two ghost devices. Harmless: both belong to the same ghost user, so message attribution looks
 * identical either way, and it's not worth a lock for something this unlikely.
 */
async function getOrCreateGhostDevice(tx: Tx, ghostUserId: string) {
  const [existing] = await tx.select().from(devices).where(eq(devices.userId, ghostUserId));
  if (existing) return existing;

  const [row] = await tx
    .insert(devices)
    .values({ userId: ghostUserId, signaturePublicKey: GHOST_DEVICE_PLACEHOLDER_KEY })
    .returning();
  if (!row) throw new Error("Failed to create the ghost device for account deletion");
  return row;
}

async function pickGroupSuccessor(
  tx: Tx,
  groupId: string,
  excludeUserId: string,
): Promise<string | null> {
  const [admin] = await tx
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, "active"),
        eq(groupMembers.role, "admin"),
        ne(groupMembers.userId, excludeUserId),
      ),
    )
    .orderBy(asc(groupMembers.createdAt))
    .limit(1);
  if (admin) return admin.userId;

  const [any] = await tx
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, "active"),
        ne(groupMembers.userId, excludeUserId),
      ),
    )
    .orderBy(asc(groupMembers.createdAt))
    .limit(1);
  return any?.userId ?? null;
}

/**
 * Deletion never blocks on group ownership the way leaveGroup's GroupOwnerError does for a
 * voluntary departure - self-service deletion has to always succeed. Prefers promoting another
 * active admin, then any other active member; only falls back to the ghost when this user was
 * the group's last member. Skips transferOwnership's "demote the old owner to admin" step since
 * that groupMembers row is about to cascade-delete entirely anyway.
 */
async function reassignGroupOwnerships(tx: Tx, userId: string, ghostId: string) {
  const owned = await tx
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.role, "owner")));

  for (const { groupId } of owned) {
    const successorId = await pickGroupSuccessor(tx, groupId, userId);

    if (successorId) {
      await tx.update(groups).set({ ownerId: successorId }).where(eq(groups.id, groupId));
      await tx
        .update(groupMembers)
        .set({ role: "owner" })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, successorId)));
    } else {
      await tx.update(groups).set({ ownerId: ghostId }).where(eq(groups.id, groupId));
    }
  }
}

/**
 * Same "never block" reasoning as reassignGroupOwnerships, but businesses have no ownerId column
 * to fall back to (confirmed - ownership lives only in businessManagers.role) - with no other
 * manager, the business simply ends up with zero managers, a legitimate (if read-only) terminal
 * state, not an error.
 */
async function reassignBusinessOwnerships(tx: Tx, userId: string) {
  const owned = await tx
    .select({ businessId: businessManagers.businessId })
    .from(businessManagers)
    .where(and(eq(businessManagers.userId, userId), eq(businessManagers.role, "owner")));

  for (const { businessId } of owned) {
    const [successor] = await tx
      .select({ userId: businessManagers.userId })
      .from(businessManagers)
      .where(and(eq(businessManagers.businessId, businessId), ne(businessManagers.userId, userId)))
      .orderBy(asc(businessManagers.createdAt))
      .limit(1);

    if (successor) {
      await tx
        .update(businessManagers)
        .set({ role: "owner" })
        .where(
          and(
            eq(businessManagers.businessId, businessId),
            eq(businessManagers.userId, successor.userId),
          ),
        );
    }
  }
}

/**
 * FR-MOD-06: permanently closes this member's account. Every FK that would otherwise RESTRICT
 * the final `DELETE FROM users` is resolved first by reassigning to one lazily-created sentinel
 * "ghost" user (see getOrCreateGhostUser) - no schema migration needed. Runs as one transaction:
 * either every reassignment and the final delete all commit, or none of them do.
 *
 * Note: packages/db/migrations/0001_rls_policies.sql's row-level-security policies aren't
 * actually enforced today (the app connects as the table owner - see docs/adr/0002) so this
 * function's cross-user updates aren't blocked by them now, but would need revisiting if
 * enforcement is ever added.
 */
export async function deleteOwnAccount(database: Database, userId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const ghost = await getOrCreateGhostUser(tx);
    const ghostDevice = await getOrCreateGhostDevice(tx, ghost.id);

    await reassignGroupOwnerships(tx, userId, ghost.id);
    await reassignBusinessOwnerships(tx, userId);

    // Posts/comments: reassigned (not just soft-deleted) so a reply thread from someone else
    // never orphans, and body is scrubbed since the member's actual intent is "forget me," not
    // just "hide my name" - the existing deletedAt convention alone (deleteComment,
    // adminDeleteContent) only ever does the latter.
    await tx
      .update(posts)
      .set({ authorId: ghost.id, body: "", deletedAt: sql`coalesce(${posts.deletedAt}, now())` })
      .where(eq(posts.authorId, userId));
    await tx
      .update(comments)
      .set({ userId: ghost.id, body: "", deletedAt: sql`coalesce(${comments.deletedAt}, now())` })
      .where(eq(comments.userId, userId));

    // Reactions carry no content of their own worth preserving, and reassigning to the ghost
    // would collide with reactions_unique_per_user if the ghost already reacted to the same
    // target on someone else's behalf - simplest and safest is to just drop this member's own.
    await tx.delete(reactions).where(eq(reactions.userId, userId));

    // Events/listings have no deletedAt column (hard-delete is adminDeleteContent's own
    // precedent for these two) - reassigning instead of deleting keeps other members' RSVPs,
    // comments and expressed interest intact rather than destroying them as collateral damage.
    await tx.update(events).set({ createdBy: ghost.id }).where(eq(events.createdBy, userId));
    await tx
      .update(listings)
      .set({ sellerId: ghost.id, status: "closed" })
      .where(eq(listings.sellerId, userId));

    // Media rows can be shared content (a business gallery photo uploaded by a non-owner
    // manager, listBusinessMedia returns every gallery row regardless of ownerId) - reassigning
    // rather than hard-deleting avoids destroying other people's shared content as a side effect
    // of one manager's own account closing.
    await tx.update(media).set({ ownerId: ghost.id }).where(eq(media.ownerId, userId));

    // conversations.directUserA/directUserB are deliberately left untouched: they have no FK at
    // all (nothing to satisfy), the inbox query never joins through them, and reassigning both
    // could collide with conversations_direct_pair_unique if this ghost already absorbed another
    // deleted user's 1:1 partner. creatorId does have a real FK and must be reassigned.
    await tx
      .update(conversations)
      .set({ creatorId: ghost.id })
      .where(eq(conversations.creatorId, userId));

    // senderDeviceId is purely a DB attribution pointer, never a decryption input (dm-client.ts's
    // client.processIncoming never takes it) - safe to repoint before this user's own device
    // rows cascade-delete below.
    const ownDevices = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.userId, userId));
    const ownDeviceIds = ownDevices.map((row) => row.id);
    if (ownDeviceIds.length > 0) {
      await tx
        .update(messages)
        .set({ senderDeviceId: ghostDevice.id })
        .where(inArray(messages.senderDeviceId, ownDeviceIds));
    }

    // Plain RESTRICT FKs to users.id with no cascade - left pointed at this id, each would block
    // the final delete below.
    await tx.update(invites).set({ inviterId: ghost.id }).where(eq(invites.inviterId, userId));
    await tx.update(reports).set({ actorId: ghost.id }).where(eq(reports.actorId, userId));
    await tx.update(auditLog).set({ actorId: ghost.id }).where(eq(auditLog.actorId, userId));
    await tx.update(users).set({ invitedBy: ghost.id }).where(eq(users.invitedBy, userId));

    // Everything else cascades already: sessions, accounts, passkeys, devices (+ keyPackages,
    // now message-free), dmBackups, blocks (both directions), businessManagers, groupMembers,
    // eventRsvps, notifications, listingInterests, relationships, conversationParticipants.
    await tx.delete(users).where(eq(users.id, userId));
  });
}
