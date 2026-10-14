import { type Database, schema } from "@plumas/db";
import type {
  FieldVisibility,
  RelationshipLabelGender,
  UserProfileInput,
} from "@plumas/validators";
import { eq } from "drizzle-orm";

import { isBlockedEitherWay } from "./block-service";
import { hasAcceptedRelationship } from "./relationship-service";

const { users } = schema;

function emptyToNull(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

/** Scoped to userId by every caller - never a client-supplied id. */
export async function updateProfile(database: Database, userId: string, data: UserProfileInput) {
  await database
    .update(users)
    .set({
      displayName: data.displayName,
      bio: emptyToNull(data.bio),
      street: emptyToNull(data.street),
      interests: data.interests && data.interests.length > 0 ? data.interests : null,
      occupation: emptyToNull(data.occupation),
      pets: emptyToNull(data.pets),
      website: emptyToNull(data.website),
      birthdayMonth: data.birthdayMonth ?? null,
      birthdayDay: data.birthdayDay ?? null,
      fieldVisibility: data.fieldVisibility ?? null,
      relationshipLabelGender: data.relationshipLabelGender ?? "neutral",
    })
    .where(eq(users.id, userId));
}

export interface ProfileView {
  id: string;
  displayName: string;
  avatarKey: string | null;
  avatarAltText: string | null;
  coverKey: string | null;
  coverAltText: string | null;
  bio: string | null;
  street: string | null;
  interests: string[] | null;
  occupation: string | null;
  pets: string | null;
  website: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  // The raw, unfiltered preference - only meaningful to the profile's own owner, who needs it
  // to populate the edit form; a non-owner viewer only ever sees the already-filtered fields
  // above, never this map itself.
  fieldVisibility: FieldVisibility | null;
  relationshipLabelGender: RelationshipLabelGender;
  joinedAt: Date;
  inviterDisplayName: string | null;
  isOwner: boolean;
}

export async function getProfile(
  database: Database,
  userId: string,
  viewerId: string,
): Promise<ProfileView | null> {
  const [user] = await database.select().from(users).where(eq(users.id, userId));
  if (!user) return null;

  // FR-MOD-03: same "not found" contract getEventById/getGroupBySlug already use for a
  // viewer who can't see something, rather than a distinct "blocked" error.
  if (viewerId !== userId && (await isBlockedEitherWay(database, viewerId, userId))) return null;

  let inviterDisplayName: string | null = null;
  if (user.invitedBy) {
    const [inviter] = await database
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user.invitedBy));
    inviterDisplayName = inviter?.displayName ?? null;
  }

  const isOwner = viewerId === userId;
  const isConnected = isOwner || (await hasAcceptedRelationship(database, viewerId, userId));
  const visibility = (user.fieldVisibility as FieldVisibility | null) ?? {};
  const visible = (field: keyof FieldVisibility) =>
    isOwner || isConnected || visibility[field] !== "connections";

  return {
    id: user.id,
    displayName: user.displayName,
    avatarKey: user.avatarKey,
    avatarAltText: user.avatarAltText,
    coverKey: user.coverKey,
    coverAltText: user.coverAltText,
    bio: user.bio,
    street: user.street,
    interests: visible("interests") ? user.interests : null,
    occupation: visible("occupation") ? user.occupation : null,
    pets: visible("pets") ? user.pets : null,
    website: visible("website") ? user.website : null,
    birthdayMonth: visible("birthday") ? user.birthdayMonth : null,
    birthdayDay: visible("birthday") ? user.birthdayDay : null,
    fieldVisibility: isOwner ? visibility : null,
    relationshipLabelGender: user.relationshipLabelGender,
    joinedAt: user.createdAt,
    inviterDisplayName,
    isOwner,
  };
}
