import { type Database, schema } from "@plumas/db";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

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
  const [userA, userB] = sortedPair(input.requesterId, input.otherUserId);

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

  return row;
}

/** FR-DM-02: inbox, most recently active conversation first. */
export async function listConversationsForUser(database: Database, userId: string) {
  return database
    .select({ conversation: conversations, participant: conversationParticipants })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(eq(conversationParticipants.userId, userId))
    .orderBy(desc(conversations.lastMessageAt));
}

export interface ConversationSummary {
  id: string;
  lastMessageAt: Date | null;
  otherUserId: string;
  otherDisplayName: string;
  otherAvatarKey: string | null;
}

/** Same ordering as listConversationsForUser, enriched with the other party's profile info. */
export async function listConversationSummariesForUser(
  database: Database,
  userId: string,
): Promise<ConversationSummary[]> {
  const rows = await listConversationsForUser(database, userId);
  if (rows.length === 0) return [];

  const otherIds = rows.map((row) =>
    row.conversation.directUserA === userId
      ? row.conversation.directUserB
      : row.conversation.directUserA,
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

  return rows.map((row, index) => {
    const otherId = otherIds[index] ?? "";
    const other = byId.get(otherId);
    return {
      id: row.conversation.id,
      lastMessageAt: row.conversation.lastMessageAt,
      otherUserId: otherId,
      otherDisplayName: other?.displayName ?? "Unknown member",
      otherAvatarKey: other?.avatarKey ?? null,
    };
  });
}

/** The other participant's profile info, for a thread's header. */
export async function getConversationSummary(
  database: Database,
  conversationId: string,
  userId: string,
): Promise<ConversationSummary> {
  const conversation = await requireActiveParticipant(database, conversationId, userId);
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
    lastMessageAt: conversation.lastMessageAt,
    otherUserId: otherId ?? "",
    otherDisplayName: other?.displayName ?? "Unknown member",
    otherAvatarKey: other?.avatarKey ?? null,
  };
}

export interface ListMessagesInput {
  conversationId: string;
  userId: string;
  cursor?: string | undefined;
  limit: number;
}

/** Keyset pagination via `messages_conversation_idx` (conversationId, id) - id is a UUIDv7. */
export async function listMessages(database: Database, input: ListMessagesInput) {
  await requireActiveParticipant(database, input.conversationId, input.userId);

  const conditions = [eq(messages.conversationId, input.conversationId)];
  if (input.cursor) conditions.push(gt(messages.id, input.cursor));

  return database
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.id))
    .limit(input.limit);
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
