import { type Database, schema } from "@plumas/db";
import type { RelationshipType } from "@plumas/validators";
import { inverseRelationshipType, relationshipLabel } from "@plumas/validators";
import { and, eq, inArray, or } from "drizzle-orm";

const { relationships, users } = schema;

export class RelationshipNotFoundError extends Error {
  constructor(message = "That relationship request no longer exists.") {
    super(message);
  }
}

export class RelationshipForbiddenError extends Error {
  constructor(message = "You can't do that to this relationship.") {
    super(message);
  }
}

export class RelationshipSelfError extends Error {
  constructor() {
    super("You can't request a relationship with yourself.");
  }
}

export class RelationshipExistsError extends Error {
  constructor() {
    super("A relationship with this member already exists.");
  }
}

function pairCondition(userA: string, userB: string) {
  return or(
    and(eq(relationships.fromUser, userA), eq(relationships.toUser, userB)),
    and(eq(relationships.fromUser, userB), eq(relationships.toUser, userA)),
  );
}

export interface RequestRelationshipInput {
  fromUserId: string;
  toUserId: string;
  type: RelationshipType;
}

/** FR-REL-01/02: creates a pending request - "I am their <type>", stored with no inversion. */
export async function requestRelationship(database: Database, input: RequestRelationshipInput) {
  if (input.fromUserId === input.toUserId) throw new RelationshipSelfError();

  const existing = await database
    .select({ id: relationships.id })
    .from(relationships)
    .where(pairCondition(input.fromUserId, input.toUserId));
  if (existing.length > 0) throw new RelationshipExistsError();

  const [row] = await database
    .insert(relationships)
    .values({ fromUser: input.fromUserId, toUser: input.toUserId, type: input.type })
    .returning();
  if (!row) throw new Error("Failed to create relationship request");
  return row;
}

/** FR-REL-02: only the recipient can accept. Idempotent if already accepted. */
export async function acceptRelationship(
  database: Database,
  relationshipId: string,
  actingUserId: string,
) {
  const [existing] = await database
    .select()
    .from(relationships)
    .where(eq(relationships.id, relationshipId));
  if (!existing) throw new RelationshipNotFoundError();
  if (existing.toUser !== actingUserId) {
    throw new RelationshipForbiddenError("Only the recipient can accept a relationship request.");
  }
  if (existing.status === "accepted") return existing;

  const [row] = await database
    .update(relationships)
    .set({ status: "accepted" })
    .where(eq(relationships.id, relationshipId))
    .returning();
  if (!row) throw new Error("Failed to accept relationship");
  return row;
}

/** FR-REL-04: either party can remove a relationship (pending or accepted) at any time. */
export async function removeRelationship(
  database: Database,
  relationshipId: string,
  actingUserId: string,
) {
  const [existing] = await database
    .select()
    .from(relationships)
    .where(eq(relationships.id, relationshipId));
  if (!existing) throw new RelationshipNotFoundError();
  if (existing.fromUser !== actingUserId && existing.toUser !== actingUserId) {
    throw new RelationshipForbiddenError();
  }

  await database.delete(relationships).where(eq(relationships.id, relationshipId));
}

/** The one relationship row (any status) between two specific users, if any. */
export async function getRelationshipBetween(database: Database, userA: string, userB: string) {
  const [row] = await database.select().from(relationships).where(pairCondition(userA, userB));
  return row ?? null;
}

export async function hasAcceptedRelationship(
  database: Database,
  userA: string,
  userB: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(eq(relationships.status, "accepted"), pairCondition(userA, userB)));
  return row !== undefined;
}

export interface RelationshipView {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  otherAvatarKey: string | null;
  // Describes the OTHER person in this row, gendered by their own preference.
  label: string;
}

async function toOtherPersonViews(
  database: Database,
  profileUserId: string,
  rows: { id: string; fromUser: string; toUser: string; type: string }[],
): Promise<RelationshipView[]> {
  if (rows.length === 0) return [];

  const otherIds = rows.map((row) => (row.fromUser === profileUserId ? row.toUser : row.fromUser));
  const otherUsers = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      relationshipLabelGender: users.relationshipLabelGender,
    })
    .from(users)
    .where(inArray(users.id, otherIds));
  const byId = new Map(otherUsers.map((user) => [user.id, user]));

  return rows.map((row) => {
    const isFromProfile = row.fromUser === profileUserId;
    const otherId = isFromProfile ? row.toUser : row.fromUser;
    const relativeType = isFromProfile
      ? inverseRelationshipType(row.type as RelationshipType)
      : (row.type as RelationshipType);
    const other = byId.get(otherId);
    return {
      id: row.id,
      otherUserId: otherId,
      otherDisplayName: other?.displayName ?? "Unknown member",
      otherAvatarKey: other?.avatarKey ?? null,
      label: relationshipLabel(relativeType, other?.relationshipLabelGender ?? "neutral"),
    };
  });
}

/** FR-REL-05: accepted relationships, visible to every member regardless of connection status. */
export async function listAcceptedRelationships(
  database: Database,
  profileUserId: string,
): Promise<RelationshipView[]> {
  const rows = await database
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.status, "accepted"),
        or(eq(relationships.fromUser, profileUserId), eq(relationships.toUser, profileUserId)),
      ),
    );
  return toOtherPersonViews(database, profileUserId, rows);
}

/** Incoming pending requests - uses the exact same direction math as the accepted list. */
export async function listIncomingRequests(
  database: Database,
  userId: string,
): Promise<RelationshipView[]> {
  const rows = await database
    .select()
    .from(relationships)
    .where(and(eq(relationships.status, "pending"), eq(relationships.toUser, userId)));
  return toOtherPersonViews(database, userId, rows);
}

export interface OutgoingRequestView {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  otherAvatarKey: string | null;
  // Describes the VIEWER (the requester), gendered by the viewer's own preference.
  myLabel: string;
}

/** Outgoing pending requests describe the viewer themselves, not the recipient. */
export async function listOutgoingRequests(
  database: Database,
  userId: string,
): Promise<OutgoingRequestView[]> {
  const rows = await database
    .select()
    .from(relationships)
    .where(and(eq(relationships.status, "pending"), eq(relationships.fromUser, userId)));
  if (rows.length === 0) return [];

  const [me] = await database
    .select({ relationshipLabelGender: users.relationshipLabelGender })
    .from(users)
    .where(eq(users.id, userId));
  const otherIds = rows.map((row) => row.toUser);
  const otherUsers = await database
    .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(users)
    .where(inArray(users.id, otherIds));
  const byId = new Map(otherUsers.map((user) => [user.id, user]));

  return rows.map((row) => {
    const other = byId.get(row.toUser);
    return {
      id: row.id,
      otherUserId: row.toUser,
      otherDisplayName: other?.displayName ?? "Unknown member",
      otherAvatarKey: other?.avatarKey ?? null,
      myLabel: relationshipLabel(row.type, me?.relationshipLabelGender ?? "neutral"),
    };
  });
}
