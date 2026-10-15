import { type Database, schema } from "@plumas/db";
import { and, eq, isNull } from "drizzle-orm";

import { listMyListings } from "./listing-service";
import { getProfile } from "./profile-service";
import { listAcceptedRelationships } from "./relationship-service";

const {
  businessManagers,
  businesses,
  comments,
  eventRsvps,
  events,
  groupMembers,
  groups,
  posts,
  reactions,
} = schema;

export interface ExportedPost {
  id: string;
  body: string;
  createdAt: Date;
  contextType: "feed" | "group" | "business";
}

export interface ExportedComment {
  id: string;
  body: string;
  createdAt: Date;
  targetType: string;
  targetId: string;
}

export interface ExportedGroupMembership {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

export interface ExportedBusinessRole {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "manager";
}

export interface ExportedEvent {
  id: string;
  title: string;
  startsAt: Date;
}

export interface ExportedRsvp {
  eventId: string;
  eventTitle: string;
  status: "going" | "interested";
}

export interface AccountDataExport {
  exportedAt: Date;
  profile: Awaited<ReturnType<typeof getProfile>>;
  posts: ExportedPost[];
  comments: ExportedComment[];
  groupMemberships: ExportedGroupMembership[];
  businessRoles: ExportedBusinessRole[];
  eventsCreated: ExportedEvent[];
  rsvps: ExportedRsvp[];
  listings: Awaited<ReturnType<typeof listMyListings>>;
  relationships: Awaited<ReturnType<typeof listAcceptedRelationships>>;
  // Counted only, not itemized - a reaction has no content of its own beyond "I reacted X to
  // post Y", and the post itself is already covered by `posts` when it's this member's own, or
  // simply isn't this member's data to export when it's someone else's.
  reactionCount: number;
}

/**
 * FR-MOD-06: everything this member owns or directly did - never another member's data, even
 * when it's attached to something of this member's (e.g. a comment someone else left on this
 * member's post is that other member's data, not this export's). DM history is deliberately not
 * here - the server only ever holds ciphertext, so that half is a client-only export
 * (dm-client.ts's exportAllConversations), never a server round-trip.
 */
export async function exportAccountData(
  database: Database,
  userId: string,
): Promise<AccountDataExport> {
  const [
    profile,
    postRows,
    commentRows,
    membershipRows,
    businessRoleRows,
    eventRows,
    rsvpRows,
    listings,
    relationships,
  ] = await Promise.all([
    getProfile(database, userId, userId),
    database
      .select({
        id: posts.id,
        body: posts.body,
        createdAt: posts.createdAt,
        contextType: posts.contextType,
      })
      .from(posts)
      .where(and(eq(posts.authorId, userId), isNull(posts.deletedAt))),
    database
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        targetType: comments.targetType,
        targetId: comments.targetId,
      })
      .from(comments)
      .where(and(eq(comments.userId, userId), isNull(comments.deletedAt))),
    database
      .select({ id: groups.id, name: groups.name, slug: groups.slug, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, "active"))),
    database
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        role: businessManagers.role,
      })
      .from(businessManagers)
      .innerJoin(businesses, eq(businesses.id, businessManagers.businessId))
      .where(eq(businessManagers.userId, userId)),
    database
      .select({ id: events.id, title: events.title, startsAt: events.startsAt })
      .from(events)
      .where(eq(events.createdBy, userId)),
    database
      .select({ eventId: events.id, eventTitle: events.title, status: eventRsvps.status })
      .from(eventRsvps)
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(eq(eventRsvps.userId, userId)),
    listMyListings(database, userId),
    listAcceptedRelationships(database, userId),
  ]);

  const reactionRows = await database
    .select({ id: reactions.id })
    .from(reactions)
    .where(eq(reactions.userId, userId));

  return {
    exportedAt: new Date(),
    profile,
    posts: postRows,
    comments: commentRows,
    groupMemberships: membershipRows,
    businessRoles: businessRoleRows,
    eventsCreated: eventRows,
    rsvps: rsvpRows,
    listings,
    relationships,
    reactionCount: reactionRows.length,
  };
}
