import { type Database, schema } from "@plumas/db";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getBlockedUserIdSet, isBlockedEitherWay } from "./block-service";
import { createNotification } from "./notification-service";

const {
  conversationParticipants,
  conversations,
  devices,
  dmBackups,
  keyPackages,
  messages,
  users,
} = schema;

export class DmNotFoundError extends Error {
  constructor(message = "That conversation no longer exists.") {
    super(message);
  }
}

export class DmForbiddenError extends Error {
  constructor(message = "You're not a participant in this conversation.") {
    super(message);
  }
}

export class DmSelfConversationError extends Error {
  constructor() {
    super("You can't start a conversation with yourself.");
  }
}

export class DmNoKeyPackageError extends Error {
  constructor(message = "That member has no device available to message right now.") {
    super(message);
  }
}

const MAX_GROUP_MEMBERS = 50;

export class DmGroupSizeError extends Error {
  constructor(message = `Groups can have at most ${String(MAX_GROUP_MEMBERS)} members.`) {
    super(message);
  }
}

export class DmGroupPermissionError extends Error {
  constructor(message = "Only the group's creator can do that.") {
    super(message);
  }
}

const MAX_NEW_CONVERSATIONS_PER_DAY = 20;
const MAX_MESSAGES_PER_MINUTE = 60;

/** FR-DM-10. */
export class DmConversationRateLimitError extends Error {
  constructor(message = `You've started too many new conversations today - try again tomorrow.`) {
    super(message);
  }
}

/** FR-DM-10. */
export class DmMessageRateLimitError extends Error {
  constructor(message = "You're sending messages too fast - slow down a bit.") {
    super(message);
  }
}

/** FR-DM-10: 20 new conversations/day, counting both direct and group creation by this user. */
async function assertUnderConversationRateLimit(database: Database, userId: string) {
  const [row] = await database.execute<{ count: string }>(sql`
    select count(*)::int as count
    from conversations
    where created_at > now() - interval '24 hours'
      and (
        (kind = 'direct' and (direct_user_a = ${userId} or direct_user_b = ${userId}))
        or (kind = 'group' and creator_id = ${userId})
      )
  `);
  if (Number(row?.count ?? 0) >= MAX_NEW_CONVERSATIONS_PER_DAY) {
    throw new DmConversationRateLimitError();
  }
}

/**
 * FR-DM-10: 60 messages/minute, across all of this user's devices. Counts every `messages` row,
 * including MLS Welcome/Commit housekeeping rows (starting a conversation, adding/removing a
 * group member) - the server can't distinguish those from a real chat message any more than
 * countUnreadForUser can (see its doc comment), so a burst of conversation/group activity can
 * eat into this budget a little. Same accepted tradeoff, applied consistently.
 */
async function assertUnderMessageRateLimit(database: Database, senderUserId: string) {
  const [row] = await database.execute<{ count: string }>(sql`
    select count(*)::int as count
    from messages m
    join devices d on d.id = m.sender_device_id
    where d.user_id = ${senderUserId}
      and m.created_at > now() - interval '1 minute'
  `);
  if (Number(row?.count ?? 0) >= MAX_MESSAGES_PER_MINUTE) {
    throw new DmMessageRateLimitError();
  }
}

/** FR-DM-21: registers a device's long-term signing key; the client caches the returned id. */
export async function registerDevice(
  database: Database,
  userId: string,
  input: { label?: string | undefined; signaturePublicKey: Buffer },
) {
  const [row] = await database
    .insert(devices)
    .values({
      userId,
      label: input.label ?? null,
      signaturePublicKey: input.signaturePublicKey.toString("base64"),
    })
    .returning();
  if (!row) throw new Error("Failed to register device");
  return row;
}

async function requireOwnedDevice(database: Database, deviceId: string, userId: string) {
  const [device] = await database
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)));
  if (!device) throw new DmForbiddenError("That device doesn't belong to you.");
  return device;
}

/** FR-DM-21: a pool of single-use KeyPackages so others can add this device to a group. */
export async function publishKeyPackages(
  database: Database,
  userId: string,
  deviceId: string,
  keyPackageBytesList: Buffer[],
) {
  await requireOwnedDevice(database, deviceId, userId);
  await database
    .insert(keyPackages)
    .values(keyPackageBytesList.map((keyPackage) => ({ deviceId, keyPackage })));
}

export async function listDevicesForUser(database: Database, userId: string) {
  return database
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
}

/**
 * Name search over active members, for the group-conversation member picker - the only
 * existing member lookup (`moderation-service.ts`'s `listMembersForAdmin`) is admin-gated, so
 * this is a separate, deliberately narrow one (name + id + avatar only) any signed-in member
 * can use. Excludes the searching member themselves and anyone suspended.
 */
export async function searchMembers(database: Database, query: string, excludeUserId: string) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  // FR-MOD-03.
  const blockedIds = await getBlockedUserIdSet(database, excludeUserId);
  const conditions = [
    sql`${users.displayName} ilike ${`%${trimmed}%`}`,
    eq(users.status, "active"),
    ne(users.id, excludeUserId),
  ];
  if (blockedIds.size > 0) conditions.push(notInArray(users.id, [...blockedIds]));

  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(and(...conditions))
    .limit(20);
}

/**
 * Claims (marks used) one of the target user's unused KeyPackages so a new conversation or
 * device-add can be built against it. Uses a single `UPDATE ... RETURNING` over a `SKIP LOCKED`
 * subquery so two concurrent claims can never hand out the same single-use KeyPackage.
 */
export async function claimKeyPackageForUser(
  database: Database,
  targetUserId: string,
): Promise<{ deviceId: string; keyPackage: Buffer } | null> {
  const rows = await database.execute<{ device_id: string; key_package: Buffer }>(sql`
    update key_packages
    set used_at = now()
    where id = (
      select kp.id
      from key_packages kp
      join devices d on d.id = kp.device_id
      where d.user_id = ${targetUserId}
        and d.revoked_at is null
        and kp.used_at is null
      order by kp.created_at asc
      limit 1
      for update skip locked
    )
    returning device_id, key_package
  `);
  const row = rows[0];
  if (!row) return null;
  return { deviceId: row.device_id, keyPackage: row.key_package };
}

function sortedPair(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

export interface CreateDirectConversationInput {
  // Client-generated, like media.ts's upload id - it's also the MLS group id, chosen before
  // the client runs createGroup, which happens before this row can exist.
  conversationId: string;
  requesterId: string;
  requesterDeviceId: string;
  otherUserId: string;
  epoch: number;
  welcomeBytes: Buffer;
}

/**
 * FR-DM-01/21: creates the 1:1 conversation row and both participants, then stores the Welcome
 * the requester's client already produced (see @plumas/crypto's `createConversation`) as the
 * first `messages` row. The matching Add commit is deliberately NOT stored here - the requester
 * already applied it locally in-memory (it's what produced the Welcome), and the joining device
 * gets the equivalent post-commit state directly from the Welcome itself via joinGroup; storing
 * it as a history row a joining device would later re-process caused it to try applying a
 * commit for an epoch its own join had already superseded. (It does need to be stored for
 * addDeviceToConversation, where OTHER EXISTING members aren't joining fresh and must apply
 * that commit to advance - see recordDeviceLinkOperations.) Enforces "one direct conversation
 * per pair" via `conversations_direct_pair_unique` - a concurrent duplicate attempt is caught
 * by that index's unique-violation error (Postgres code 23505), not a select-then-insert race.
 */
export async function createDirectConversation(
  database: Database,
  input: CreateDirectConversationInput,
) {
  if (input.requesterId === input.otherUserId) throw new DmSelfConversationError();
  // FR-MOD-03.
  if (await isBlockedEitherWay(database, input.requesterId, input.otherUserId)) {
    throw new DmForbiddenError("You can't message this member.");
  }
  const [userA, userB] = sortedPair(input.requesterId, input.otherUserId);

  // The UI calls this every time "Message" is clicked, even for a pair that already has a
  // conversation (relying on the catch-unique-violation fallback below) - so re-opening an old
  // thread must never spend FR-DM-10's daily budget. Only a pair with no row yet reaches the
  // rate-limit check and the insert; the uniqueness guarantee itself still comes from the index
  // and the catch block, not from this lookup (same race-safety reasoning as the doc comment).
  const [alreadyExists] = await database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.kind, "direct"),
        eq(conversations.directUserA, userA),
        eq(conversations.directUserB, userB),
      ),
    );
  if (alreadyExists) return alreadyExists;

  await assertUnderConversationRateLimit(database, input.requesterId);

  try {
    const [conversation] = await database
      .insert(conversations)
      .values({
        id: input.conversationId,
        kind: "direct",
        directUserA: userA,
        directUserB: userB,
        epoch: input.epoch,
        lastMessageAt: new Date(),
      })
      .returning();
    if (!conversation) throw new Error("Failed to create conversation");

    await database.insert(conversationParticipants).values([
      { conversationId: conversation.id, userId: input.requesterId, status: "active" },
      { conversationId: conversation.id, userId: input.otherUserId, status: "active" },
    ]);

    await database.insert(messages).values({
      id: uuidv7(),
      conversationId: conversation.id,
      senderDeviceId: input.requesterDeviceId,
      epoch: input.epoch,
      ciphertext: input.welcomeBytes,
    });

    return conversation;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [existing] = await database
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.kind, "direct"),
            eq(conversations.directUserA, userA),
            eq(conversations.directUserB, userB),
          ),
        );
      if (existing) return existing;
    }
    throw error;
  }
}

export interface CreateGroupConversationInput {
  // Client-generated, same reasoning as CreateDirectConversationInput's conversationId.
  conversationId: string;
  creatorId: string;
  creatorDeviceId: string;
  name: string;
  memberUserIds: string[];
  epoch: number;
  welcomeBytes: Buffer;
  // FR-DM-15: tags this group as a business's own conversation with its managers, so
  // findBusinessConversationForUser can find and reuse it on a later "message this business".
  businessId?: string | undefined;
}

/**
 * FR-DM-01/12/19: creates a group conversation and stores the one Welcome the creator's client
 * already produced (@plumas/crypto's `createConversation`, generalized in task #23 to accept
 * multiple initial members) - same "no commit row" reasoning as `createDirectConversation`: the
 * creator already has the resulting state, and a single multi-recipient Welcome is all every
 * invited member needs to join independently. No pair-uniqueness constraint - members can share
 * more than one group.
 */
export async function createGroupConversation(
  database: Database,
  input: CreateGroupConversationInput,
) {
  if (input.memberUserIds.length === 0) {
    throw new Error("A group needs at least one other member");
  }
  if (input.memberUserIds.includes(input.creatorId)) {
    throw new DmSelfConversationError();
  }
  if (1 + input.memberUserIds.length > MAX_GROUP_MEMBERS) {
    throw new DmGroupSizeError();
  }
  await assertUnderConversationRateLimit(database, input.creatorId);

  const [conversation] = await database
    .insert(conversations)
    .values({
      id: input.conversationId,
      kind: "group",
      name: input.name,
      creatorId: input.creatorId,
      businessId: input.businessId ?? null,
      epoch: input.epoch,
      lastMessageAt: new Date(),
    })
    .returning();
  if (!conversation) throw new Error("Failed to create group conversation");

  await database.insert(conversationParticipants).values([
    { conversationId: conversation.id, userId: input.creatorId, status: "active" },
    ...input.memberUserIds.map((userId) => ({
      conversationId: conversation.id,
      userId,
      status: "active" as const,
    })),
  ]);

  await database.insert(messages).values({
    id: uuidv7(),
    conversationId: conversation.id,
    senderDeviceId: input.creatorDeviceId,
    epoch: input.epoch,
    ciphertext: input.welcomeBytes,
  });

  return conversation;
}

/**
 * FR-DM-15: finds this user's existing "message this business" group conversation, if any, so
 * repeat clicks on "Message this business" reuse the one thread instead of creating a new group
 * every time.
 */
export async function findBusinessConversationForUser(
  database: Database,
  businessId: string,
  userId: string,
) {
  const [row] = await database
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.kind, "group"),
        eq(conversations.businessId, businessId),
        eq(conversationParticipants.userId, userId),
        eq(conversationParticipants.status, "active"),
      ),
    );
  return row?.conversation ?? null;
}

async function requireGroupCreator(database: Database, conversationId: string, userId: string) {
  const [conversation] = await database
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) throw new DmNotFoundError();
  if (conversation.kind !== "group") throw new Error("Not a group conversation");
  if (conversation.creatorId !== userId) throw new DmGroupPermissionError();
  return conversation;
}

export interface AddGroupMemberInput {
  conversationId: string;
  actingUserId: string;
  actingDeviceId: string;
  newUserId: string;
  epoch: number;
  welcomeBytes: Buffer;
  commitBytes: Buffer;
}

/**
 * FR-DM-12: only the creator can add a member. Stores both the Welcome (for the new member to
 * join from) and the Commit (for every other existing member to advance their epoch) - unlike
 * group creation, other members already exist here and need it, same reasoning as
 * `recordDeviceLinkOperations`.
 */
export async function addGroupMember(database: Database, input: AddGroupMemberInput) {
  const conversation = await requireGroupCreator(
    database,
    input.conversationId,
    input.actingUserId,
  );
  if (input.newUserId === input.actingUserId) throw new DmSelfConversationError();

  const [countRow] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.status, "active"),
      ),
    );
  if ((countRow?.count ?? 0) + 1 > MAX_GROUP_MEMBERS) throw new DmGroupSizeError();

  await database
    .insert(conversationParticipants)
    .values({ conversationId: input.conversationId, userId: input.newUserId, status: "active" })
    .onConflictDoUpdate({
      target: [conversationParticipants.conversationId, conversationParticipants.userId],
      set: { status: "active" },
    });

  await database.insert(messages).values([
    {
      id: uuidv7(),
      conversationId: input.conversationId,
      senderDeviceId: input.actingDeviceId,
      epoch: input.epoch,
      ciphertext: input.welcomeBytes,
    },
    {
      id: uuidv7(),
      conversationId: input.conversationId,
      senderDeviceId: input.actingDeviceId,
      epoch: input.epoch,
      ciphertext: input.commitBytes,
    },
  ]);

  await database
    .update(conversations)
    .set({ epoch: input.epoch, lastMessageAt: new Date() })
    .where(eq(conversations.id, input.conversationId));

  const [actor] = await database
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.actingUserId));
  await createNotification(database, {
    userId: input.newUserId,
    type: "dm_added_to_group",
    payload: {
      actorId: input.actingUserId,
      actorName: actor?.displayName ?? "A member",
      conversationId: input.conversationId,
      groupName: conversation.name ?? "a group chat",
    },
  });
}

export interface RemoveGroupMemberInput {
  conversationId: string;
  actingUserId: string;
  actingDeviceId: string;
  targetUserId: string;
  epoch: number;
  commitBytes: Buffer;
}

/**
 * FR-DM-12: removes a member from a group - either the creator removing someone involuntarily,
 * or any other active member finalizing someone's own prior voluntary departure (see
 * `requestToLeaveGroup`'s doc comment for why that's two separate steps). No Welcome - nobody
 * is joining.
 */
export async function removeGroupMember(database: Database, input: RemoveGroupMemberInput) {
  const conversation = await requireActiveParticipant(
    database,
    input.conversationId,
    input.actingUserId,
  );
  if (conversation.kind !== "group") throw new Error("Not a group conversation");

  const [target] = await database
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.userId, input.targetUserId),
      ),
    );
  const creatorRemovingSomeoneElse =
    conversation.creatorId === input.actingUserId && input.targetUserId !== input.actingUserId;
  const finalizingAVoluntaryLeave = target?.status === "left";
  if (!creatorRemovingSomeoneElse && !finalizingAVoluntaryLeave) {
    throw new DmGroupPermissionError();
  }

  await database
    .update(conversationParticipants)
    .set({ status: "left" })
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.userId, input.targetUserId),
      ),
    );

  await database.insert(messages).values({
    id: uuidv7(),
    conversationId: input.conversationId,
    senderDeviceId: input.actingDeviceId,
    epoch: input.epoch,
    ciphertext: input.commitBytes,
  });

  await database
    .update(conversations)
    .set({ epoch: input.epoch })
    .where(eq(conversations.id, input.conversationId));
}

/**
 * FR-DM-12 "any member can leave": a member can't cryptographically remove themselves (ts-mls
 * rejects a commit that removes its own committer - see @plumas/crypto's `removeGroupMember`
 * doc comment), so leaving is two steps - this marks the caller's own participation as "left"
 * immediately (they stop being an active participant, won't be fetched as one going forward);
 * the actual MLS removal happens the next time any other active member's client notices them in
 * `listPendingDepartures` and calls `removeGroupMember` on their behalf.
 */
export async function requestToLeaveGroup(
  database: Database,
  conversationId: string,
  userId: string,
) {
  const conversation = await requireActiveParticipant(database, conversationId, userId);
  if (conversation.kind !== "group") throw new Error("Not a group conversation");

  await database
    .update(conversationParticipants)
    .set({ status: "left" })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    );
}

/**
 * Members who've left (voluntarily or removed) but may not yet be cryptographically excluded -
 * a client with local state for this group checks this and finalizes via `removeGroupMember`.
 * It's fine to call that for someone already excluded from the local ratchet tree; the crypto
 * layer throws cleanly and the caller just ignores it (best-effort cleanup, not a strict
 * invariant - see @plumas/crypto's `removeGroupMember` doc comment).
 */
export async function listPendingDepartures(
  database: Database,
  conversationId: string,
): Promise<string[]> {
  const rows = await database
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.status, "left"),
      ),
    );
  return rows.map((row) => row.userId);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function requireActiveParticipant(
  database: Database,
  conversationId: string,
  userId: string,
) {
  const [conversation] = await database
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) throw new DmNotFoundError();

  const [participant] = await database
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    );
  if (!participant || participant.status === "left") throw new DmForbiddenError();
  return conversation;
}

export interface SendMessageInput {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  epoch: number;
  ciphertext: Buffer;
}

/** FR-DM-09: stores ciphertext only - no plaintext ever passes through this function. */
export async function sendMessage(database: Database, input: SendMessageInput) {
  await requireActiveParticipant(database, input.conversationId, input.senderUserId);

  // FR-MOD-03: only direct (1:1) conversations are gated - a shared group chat's existing
  // membership isn't retroactively broken by a block between two of its members, same as this
  // task's relationship/comment gates only stop *new* interactions, not unwind existing ones.
  const [conversation] = await database
    .select({
      kind: conversations.kind,
      directUserA: conversations.directUserA,
      directUserB: conversations.directUserB,
    })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId));
  if (conversation?.kind === "direct") {
    const otherUserId =
      conversation.directUserA === input.senderUserId
        ? conversation.directUserB
        : conversation.directUserA;
    if (otherUserId && (await isBlockedEitherWay(database, input.senderUserId, otherUserId))) {
      throw new DmForbiddenError("You can't message this member.");
    }
  }

  await assertUnderMessageRateLimit(database, input.senderUserId);

  const [row] = await database
    .insert(messages)
    .values({
      id: uuidv7(),
      conversationId: input.conversationId,
      senderDeviceId: input.senderDeviceId,
      epoch: input.epoch,
      ciphertext: input.ciphertext,
    })
    .returning();
  if (!row) throw new Error("Failed to send message");

  await database
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, input.conversationId));

  // FR-DM-16: a new message revives the thread for anyone who'd hidden it from their own inbox.
  await database
    .update(conversationParticipants)
    .set({ hiddenAt: null })
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        ne(conversationParticipants.userId, input.senderUserId),
      ),
    );

  await notifyOtherParticipants(database, input.conversationId, input.senderUserId, "dm_message");

  return row;
}

/**
 * FR-NOT-01: one notification per other active participant - messages are E2EE (sendMessage
 * stores ciphertext only), so this can say who sent something, never what - no content preview
 * is available server-side.
 */
async function notifyOtherParticipants(
  database: Database,
  conversationId: string,
  senderUserId: string,
  type: "dm_message",
) {
  const [sender] = await database
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, senderUserId));
  const others = await database
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.status, "active"),
      ),
    );

  for (const other of others) {
    if (other.userId === senderUserId) continue;
    await createNotification(database, {
      userId: other.userId,
      type,
      payload: {
        actorId: senderUserId,
        actorName: sender?.displayName ?? "A member",
        conversationId,
      },
    });
  }
}

const UNSEND_WINDOW_MINUTES = 15;

/** FR-DM-16. */
export class DmUnsendWindowExpiredError extends Error {
  constructor(
    message = `You can only unsend a message within ${String(UNSEND_WINDOW_MINUTES)} minutes of sending it.`,
  ) {
    super(message);
  }
}

/**
 * FR-DM-16: deletes a message's ciphertext server-side (not just a client-side hide) within 15
 * minutes of sending. Only the sender - checked via device ownership, the same shape as
 * `requireOwnedDevice` - can unsend their own message.
 */
export async function unsendMessage(database: Database, messageId: string, userId: string) {
  const [row] = await database
    .select({
      id: messages.id,
      createdAt: messages.createdAt,
      senderUserId: devices.userId,
      unsentAt: messages.unsentAt,
    })
    .from(messages)
    .innerJoin(devices, eq(devices.id, messages.senderDeviceId))
    .where(eq(messages.id, messageId));
  if (!row) throw new DmNotFoundError("That message no longer exists.");
  if (row.senderUserId !== userId) {
    throw new DmForbiddenError("You can only unsend your own messages.");
  }
  if (row.unsentAt) return;
  const ageMs = Date.now() - row.createdAt.getTime();
  if (ageMs > UNSEND_WINDOW_MINUTES * 60 * 1000) throw new DmUnsendWindowExpiredError();

  await database
    .update(messages)
    .set({ unsentAt: new Date(), ciphertext: null })
    .where(eq(messages.id, messageId));
}

/** FR-DM-16: deletes a conversation from this participant's own inbox only. */
export async function hideConversationForUser(
  database: Database,
  conversationId: string,
  userId: string,
) {
  await requireActiveParticipant(database, conversationId, userId);
  await database
    .update(conversationParticipants)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    );
}

/**
 * FR-DM-02: inbox, most recently active conversation first. FR-DM-07: a direct conversation with
 * a now-blocked member is excluded, either direction - group conversations are left alone, same
 * reasoning as sendMessage's own block check (shared membership isn't retroactively hidden by a
 * block between two of its members). FR-DM-16: a conversation this user hid is excluded too,
 * until it's revived by a new inbound message (see sendMessage).
 */
export async function listConversationsForUser(database: Database, userId: string) {
  const blockedIds = await getBlockedUserIdSet(database, userId);
  const rows = await database
    .select({ conversation: conversations, participant: conversationParticipants })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(
      and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.hiddenAt)),
    )
    .orderBy(desc(conversations.lastMessageAt));

  if (blockedIds.size === 0) return rows;
  return rows.filter((row) => {
    if (row.conversation.kind !== "direct") return true;
    const otherId =
      row.conversation.directUserA === userId
        ? row.conversation.directUserB
        : row.conversation.directUserA;
    return otherId === null || !blockedIds.has(otherId);
  });
}

export interface ConversationSummary {
  id: string;
  kind: "direct" | "group";
  lastMessageAt: Date | null;
  // Direct: the other person's name/avatar. Group: the group's own name, no avatar concept yet.
  displayName: string;
  avatarKey: string | null;
  // Direct only.
  otherUserId: string | null;
  // Group only.
  memberCount: number | null;
  // Group only - false for direct conversations, nobody "creates" a 1:1 in that sense.
  isCreator: boolean;
}

async function activeMemberCounts(
  database: Database,
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await database
    .select({
      conversationId: conversationParticipants.conversationId,
      count: sql<number>`count(*)::int`,
    })
    .from(conversationParticipants)
    .where(
      and(
        inArray(conversationParticipants.conversationId, conversationIds),
        eq(conversationParticipants.status, "active"),
      ),
    )
    .groupBy(conversationParticipants.conversationId);
  return new Map(rows.map((row) => [row.conversationId, row.count]));
}

/** Same ordering as listConversationsForUser, enriched with display info for each kind. */
export async function listConversationSummariesForUser(
  database: Database,
  userId: string,
): Promise<ConversationSummary[]> {
  const rows = await listConversationsForUser(database, userId);
  if (rows.length === 0) return [];

  const otherIds = rows.map((row) =>
    row.conversation.kind === "direct"
      ? row.conversation.directUserA === userId
        ? row.conversation.directUserB
        : row.conversation.directUserA
      : null,
  );
  const otherUsers = await database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(
      inArray(
        users.id,
        otherIds.filter((id): id is string => id !== null),
      ),
    );
  const byId = new Map(otherUsers.map((user) => [user.id, user]));
  const groupIds = rows
    .filter((row) => row.conversation.kind === "group")
    .map((row) => row.conversation.id);
  const memberCounts = await activeMemberCounts(database, groupIds);

  return rows.map((row, index) => {
    if (row.conversation.kind === "group") {
      return {
        id: row.conversation.id,
        kind: "group" as const,
        lastMessageAt: row.conversation.lastMessageAt,
        displayName: row.conversation.name ?? "Unnamed group",
        avatarKey: null,
        otherUserId: null,
        memberCount: memberCounts.get(row.conversation.id) ?? null,
        isCreator: row.conversation.creatorId === userId,
      };
    }
    const otherId = otherIds[index] ?? "";
    const other = byId.get(otherId);
    return {
      id: row.conversation.id,
      kind: "direct" as const,
      lastMessageAt: row.conversation.lastMessageAt,
      displayName: other?.displayName ?? "Unknown member",
      avatarKey: other?.avatarKey ?? null,
      otherUserId: otherId,
      memberCount: null,
      isCreator: false,
    };
  });
}

/** Display info for a thread's header. */
export async function getConversationSummary(
  database: Database,
  conversationId: string,
  userId: string,
): Promise<ConversationSummary> {
  const conversation = await requireActiveParticipant(database, conversationId, userId);

  if (conversation.kind === "group") {
    const counts = await activeMemberCounts(database, [conversationId]);
    return {
      id: conversation.id,
      kind: "group",
      lastMessageAt: conversation.lastMessageAt,
      displayName: conversation.name ?? "Unnamed group",
      avatarKey: null,
      otherUserId: null,
      memberCount: counts.get(conversationId) ?? null,
      isCreator: conversation.creatorId === userId,
    };
  }

  const otherId =
    conversation.directUserA === userId ? conversation.directUserB : conversation.directUserA;
  const [other] = otherId
    ? await database
        .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, otherId))
    : [];
  return {
    id: conversation.id,
    kind: "direct",
    lastMessageAt: conversation.lastMessageAt,
    displayName: other?.displayName ?? "Unknown member",
    avatarKey: other?.avatarKey ?? null,
    otherUserId: otherId ?? "",
    memberCount: null,
    isCreator: false,
  };
}

/** Active members of a group, for the "manage members" UI. Includes the creator. */
export async function listGroupMembers(database: Database, conversationId: string, userId: string) {
  const conversation = await requireActiveParticipant(database, conversationId, userId);
  if (conversation.kind !== "group") throw new Error("Not a group conversation");

  return database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(conversationParticipants)
    .innerJoin(users, eq(users.id, conversationParticipants.userId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.status, "active"),
      ),
    );
}

export interface ListMessagesInput {
  conversationId: string;
  userId: string;
  cursor?: string | undefined;
  limit: number;
}

/**
 * Keyset pagination via `messages_conversation_idx` (conversationId, id) - id is a UUIDv7.
 * `senderUserId`/`senderDisplayName` are resolved via the sending device for every row (cheap,
 * and a 1:1 thread just doesn't use them - a group thread needs them to label who sent what).
 */
export async function listMessages(database: Database, input: ListMessagesInput) {
  await requireActiveParticipant(database, input.conversationId, input.userId);

  const conditions = [eq(messages.conversationId, input.conversationId)];
  if (input.cursor) conditions.push(gt(messages.id, input.cursor));

  return database
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderDeviceId: messages.senderDeviceId,
      senderUserId: devices.userId,
      senderDisplayName: users.displayName,
      epoch: messages.epoch,
      ciphertext: messages.ciphertext,
      unsentAt: messages.unsentAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(devices, eq(devices.id, messages.senderDeviceId))
    .innerJoin(users, eq(users.id, devices.userId))
    .where(and(...conditions))
    .orderBy(asc(messages.id))
    .limit(input.limit);
}

/**
 * FR-DM-04: advances this participant's read cursor, never backward. Intentionally takes the id
 * of the furthest message the client *fetched* (not just the furthest one with visible content)
 * - messages.id is a UUIDv7, so plain comparison already sorts chronologically, the same
 * assumption listMessages's own cursor pagination relies on. See countUnreadForUser's doc
 * comment for why "furthest fetched" (not "furthest visible") is the right cursor to store.
 */
export async function markConversationRead(
  database: Database,
  conversationId: string,
  userId: string,
  messageId: string,
) {
  await database
    .update(conversationParticipants)
    .set({ lastReadMessageId: messageId })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
        or(
          isNull(conversationParticipants.lastReadMessageId),
          lt(conversationParticipants.lastReadMessageId, messageId),
        ),
      ),
    );
}

export interface UnreadCounts {
  total: number;
  byConversation: Record<string, number>;
}

/**
 * FR-DM-04: unread counts per conversation, plus the total for the nav badge.
 * Known, accepted imprecision: the server stores MLS ciphertext only (FR-DM-09) and can't tell a
 * real chat message from a Welcome/Commit housekeeping row - only client-side decryption can
 * (see @plumas/crypto's ProcessIncomingResult). So a rare event like someone else linking a
 * device, or a group membership change, can bump this count with nothing new to actually read.
 * This self-corrects the next time the thread is opened, since markConversationRead is called
 * with the furthest *fetched* message id, not just the furthest visible one.
 */
export async function countUnreadForUser(
  database: Database,
  userId: string,
): Promise<UnreadCounts> {
  const rows = await database.execute<{ conversation_id: string; count: string }>(sql`
    select cp.conversation_id, count(m.id)::int as count
    from conversation_participants cp
    join messages m on m.conversation_id = cp.conversation_id
    where cp.user_id = ${userId}
      and cp.hidden_at is null
      and (cp.last_read_message_id is null or m.id > cp.last_read_message_id)
    group by cp.conversation_id
  `);

  const byConversation: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count);
    byConversation[row.conversation_id] = count;
    total += count;
  }
  return { total, byConversation };
}

export interface RecordDeviceLinkOperation {
  conversationId: string;
  epoch: number;
  welcomeBytes: Buffer;
  commitBytes: Buffer;
}

/**
 * FR-DM-21: an already-trusted device has just added a newly-linked device to each of its
 * existing conversations (@plumas/crypto's `addDeviceToConversation`, run once per
 * conversation) - stores the resulting Welcome/Commit pairs as ordinary `messages` rows.
 */
export async function recordDeviceLinkOperations(
  database: Database,
  actingUserId: string,
  actingDeviceId: string,
  operations: RecordDeviceLinkOperation[],
) {
  await requireOwnedDevice(database, actingDeviceId, actingUserId);
  for (const op of operations) {
    await requireActiveParticipant(database, op.conversationId, actingUserId);
    await database.insert(messages).values([
      {
        id: uuidv7(),
        conversationId: op.conversationId,
        senderDeviceId: actingDeviceId,
        epoch: op.epoch,
        ciphertext: op.welcomeBytes,
      },
      {
        id: uuidv7(),
        conversationId: op.conversationId,
        senderDeviceId: actingDeviceId,
        epoch: op.epoch,
        ciphertext: op.commitBytes,
      },
    ]);
    await database
      .update(conversations)
      .set({ epoch: op.epoch })
      .where(eq(conversations.id, op.conversationId));
  }
}

export interface CreateBackupInput {
  userId: string;
  r2Key: string;
  wrappedBackupKey: Buffer;
}

/** FR-DM-22: one backup per user, overwritten on each new backup. */
export async function upsertBackup(database: Database, input: CreateBackupInput) {
  const [row] = await database
    .insert(dmBackups)
    .values({
      userId: input.userId,
      r2Key: input.r2Key,
      wrappedBackupKey: input.wrappedBackupKey,
    })
    .onConflictDoUpdate({
      target: dmBackups.userId,
      set: { r2Key: input.r2Key, wrappedBackupKey: input.wrappedBackupKey, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to save backup");
  return row;
}

export async function getBackup(database: Database, userId: string) {
  const [row] = await database.select().from(dmBackups).where(eq(dmBackups.userId, userId));
  return row ?? null;
}
