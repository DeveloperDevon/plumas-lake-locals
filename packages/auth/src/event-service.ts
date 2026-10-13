import {
  type Database,
  generateCalendarFeedToken,
  hashCalendarFeedToken,
  schema,
} from "@plumas/db";
import type { EventHostType, EventRecurrence, ReactionType, RsvpStatus } from "@plumas/validators";
import { reactionTypes } from "@plumas/validators";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { RRule } from "rrule";

import { requireManager } from "./business-service";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentReplyDepthError,
  notifyAboutComment,
} from "./comment-service";
import { GroupForbiddenError, requireActiveGroupMember } from "./group-service";
import { writeAuditLog } from "./moderation-service";
import { createNotification } from "./notification-service";

const { businesses, comments, events, eventRsvps, groupMembers, groups, reactions, users } = schema;

/** FR-CAL-05: weekly/monthly only - the literal RRULE text stored in events.rrule. */
function recurrenceToRrule(recurrence: EventRecurrence | undefined): string | null {
  if (!recurrence || recurrence === "none") return null;
  return recurrence === "weekly" ? "FREQ=WEEKLY" : "FREQ=MONTHLY";
}

function rruleToRecurrence(rrule: string | null): EventRecurrence {
  if (rrule === "FREQ=WEEKLY") return "weekly";
  if (rrule === "FREQ=MONTHLY") return "monthly";
  return "none";
}

export class EventNotFoundError extends Error {
  constructor(message = "That event no longer exists.") {
    super(message);
  }
}

export class EventForbiddenError extends Error {
  constructor(message = "You can't do that to this event.") {
    super(message);
  }
}

export async function requireEventCreator(
  database: Database,
  eventId: string,
  actingUserId: string,
) {
  const [event] = await database.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new EventNotFoundError();
  if (event.createdBy !== actingUserId) {
    throw new EventForbiddenError("Only this event's creator can do that.");
  }
  return event;
}

async function requireAdmin(database: Database, actingUserId: string) {
  const [actingUser] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (actingUser?.role !== "admin") throw new EventForbiddenError("Admins only.");
}

/** FR-CAL-11: throws unless the viewer can see a group-hosted event - public groups are open, private ones require active membership. */
async function requireHostVisible(
  database: Database,
  hostType: EventHostType,
  hostId: string,
  viewerId: string,
) {
  if (hostType !== "group") return;
  const [group] = await database.select().from(groups).where(eq(groups.id, hostId));
  if (group?.visibility !== "private") return;
  await requireActiveGroupMember(database, hostId, viewerId);
}

export interface CreateEventInput {
  createdBy: string;
  title: string;
  description?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  allDay: boolean;
  location?: string | undefined;
  hostType?: EventHostType | undefined;
  hostId?: string | undefined;
  recurrence?: EventRecurrence | undefined;
}

/** FR-CAL-01/02: hosting under a group/business requires the same posting permission each already enforces for its own board. */
export async function createEvent(database: Database, input: CreateEventInput) {
  if (input.hostType === "group" && input.hostId) {
    await requireActiveGroupMember(database, input.hostId, input.createdBy);
  } else if (input.hostType === "business" && input.hostId) {
    await requireManager(database, input.hostId, input.createdBy);
  }

  const [row] = await database
    .insert(events)
    .values({
      createdBy: input.createdBy,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay,
      location: input.location ?? null,
      hostType: input.hostType ?? null,
      hostId: input.hostId ?? null,
      rrule: recurrenceToRrule(input.recurrence),
    })
    .returning();
  if (!row) throw new Error("Failed to create event");
  return row;
}

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  coverKey: string | null;
  coverAltText: string | null;
  createdAt: Date;
  createdBy: string;
  creatorDisplayName: string;
  creatorAvatarKey: string | null;
  hostType: EventHostType | null;
  hostId: string | null;
  hostName: string | null;
  hostSlug: string | null;
  // FR-CAL-05: the parsed form of events.rrule, for UI; rrule itself (the raw ICS text, or
  // null) is what ics.ts needs for export/feed generation.
  recurrence: EventRecurrence;
  rrule: string | null;
}

async function resolveHost(
  database: Database,
  hostType: EventHostType | null,
  hostId: string | null,
): Promise<{ hostName: string | null; hostSlug: string | null }> {
  if (!hostType || !hostId) return { hostName: null, hostSlug: null };
  if (hostType === "group") {
    const [group] = await database
      .select({ name: groups.name, slug: groups.slug })
      .from(groups)
      .where(eq(groups.id, hostId));
    return { hostName: group?.name ?? null, hostSlug: group?.slug ?? null };
  }
  const [business] = await database
    .select({ name: businesses.name, slug: businesses.slug })
    .from(businesses)
    .where(eq(businesses.id, hostId));
  return { hostName: business?.name ?? null, hostSlug: business?.slug ?? null };
}

/** FR-CAL-11: returns null for a private-group-hosted event the viewer isn't an active member of. */
export async function getEventById(
  database: Database,
  eventId: string,
  viewerId: string,
): Promise<EventView | null> {
  const [row] = await database
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      location: events.location,
      coverKey: events.coverKey,
      coverAltText: events.coverAltText,
      createdAt: events.createdAt,
      createdBy: events.createdBy,
      hostType: events.hostType,
      hostId: events.hostId,
      rrule: events.rrule,
      creatorDisplayName: users.displayName,
      creatorAvatarKey: users.avatarKey,
    })
    .from(events)
    .innerJoin(users, eq(events.createdBy, users.id))
    .where(eq(events.id, eventId));
  if (!row) return null;

  if (row.hostType && row.hostId) {
    try {
      await requireHostVisible(database, row.hostType, row.hostId, viewerId);
    } catch (error) {
      if (error instanceof GroupForbiddenError) return null;
      throw error;
    }
  }

  const { hostName, hostSlug } = await resolveHost(database, row.hostType, row.hostId);
  return { ...row, hostName, hostSlug, recurrence: rruleToRecurrence(row.rrule) };
}

export interface EventSummary {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  coverKey: string | null;
  hostType: EventHostType | null;
  hostId: string | null;
  hostName: string | null;
  recurrence: EventRecurrence;
}

type EventRow = typeof events.$inferSelect;

/** Shared by listEventsInRange and listAllVisibleEventsForFeed - FR-CAL-11's private-group check, batched (never N+1). Also hands back groupById so callers that already need group names (for hostName) don't run a second query. */
async function filterVisibleEventRows<T extends Pick<EventRow, "hostType" | "hostId">>(
  database: Database,
  rows: T[],
  viewerId: string,
) {
  const groupHostIds = [
    ...new Set(
      rows
        .filter(
          (row): row is T & { hostId: string } => row.hostType === "group" && Boolean(row.hostId),
        )
        .map((row) => row.hostId),
    ),
  ];
  const groupRows =
    groupHostIds.length > 0
      ? await database
          .select({ id: groups.id, name: groups.name, visibility: groups.visibility })
          .from(groups)
          .where(inArray(groups.id, groupHostIds))
      : [];
  const groupById = new Map(groupRows.map((group) => [group.id, group]));

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
    if (row.hostType !== "group" || !row.hostId) return true;
    const group = groupById.get(row.hostId);
    if (group?.visibility !== "private") return true;
    return visiblePrivateGroupIds.has(row.hostId);
  });

  return { visible, groupById };
}

async function resolveHostNames(
  database: Database,
  rows: readonly Pick<EventRow, "hostType" | "hostId">[],
  groupById: Map<string, { name: string }>,
) {
  const businessHostIds = [
    ...new Set(
      rows
        .filter(
          (row): row is typeof row & { hostId: string } =>
            row.hostType === "business" && Boolean(row.hostId),
        )
        .map((row) => row.hostId),
    ),
  ];
  const businessRows =
    businessHostIds.length > 0
      ? await database
          .select({ id: businesses.id, name: businesses.name })
          .from(businesses)
          .where(inArray(businesses.id, businessHostIds))
      : [];
  const businessById = new Map(businessRows.map((business) => [business.id, business]));

  return (row: Pick<EventRow, "hostType" | "hostId">): string | null => {
    if (row.hostType === "group") return groupById.get(row.hostId ?? "")?.name ?? null;
    if (row.hostType === "business") return businessById.get(row.hostId ?? "")?.name ?? null;
    return null;
  };
}

/**
 * FR-CAL-05: expands a recurring row's rrule into its occurrences inside [start, end). Uses the
 * `rrule` package's own UTC-based calendar math on the stored (UTC) startsAt as the anchor - a
 * known, accepted simplification: a monthly-recurring event's Pacific wall-clock time can shift
 * by an hour across a DST boundary, the same way a plain "add one month in UTC" would. Exact
 * timezone-aware recurrence would need a TZID-aware RRULE evaluator; out of scope for a P1
 * weekly/monthly-only feature.
 */
function expandOccurrences(
  row: EventRow,
  start: Date,
  end: Date,
): { startsAt: Date; endsAt: Date | null }[] {
  if (!row.rrule) return [{ startsAt: row.startsAt, endsAt: row.endsAt }];
  const rule = new RRule({
    freq: row.rrule === "FREQ=WEEKLY" ? RRule.WEEKLY : RRule.MONTHLY,
    dtstart: row.startsAt,
  });
  const durationMs = row.endsAt ? row.endsAt.getTime() - row.startsAt.getTime() : null;
  return rule.between(start, end, true).map((occursAt) => ({
    startsAt: occursAt,
    endsAt: durationMs !== null ? new Date(occursAt.getTime() + durationMs) : null,
  }));
}

/** FR-CAL-03: feeds the agenda/week/month views - one range query, then a batched visibility filter (never N+1), then recurring rows are expanded into their in-range occurrences. */
export async function listEventsInRange(
  database: Database,
  { start, end, viewerId }: { start: Date; end: Date; viewerId: string },
): Promise<EventSummary[]> {
  // A recurring event's stored startsAt is only its first occurrence, which can be well outside
  // the queried range even though later occurrences fall inside it - so recurring rows are
  // fetched regardless of their own startsAt (bounded only by not having started after `end`).
  const rows = await database
    .select()
    .from(events)
    .where(
      or(
        and(gte(events.startsAt, start), lte(events.startsAt, end)),
        and(isNotNull(events.rrule), lte(events.startsAt, end)),
      ),
    )
    .orderBy(asc(events.startsAt));

  const { visible, groupById } = await filterVisibleEventRows(database, rows, viewerId);
  const hostNameFor = await resolveHostNames(database, visible, groupById);

  const result: EventSummary[] = [];
  for (const row of visible) {
    const base = {
      id: row.id,
      title: row.title,
      allDay: row.allDay,
      location: row.location,
      coverKey: row.coverKey,
      hostType: row.hostType,
      hostId: row.hostId,
      hostName: hostNameFor(row),
      recurrence: rruleToRecurrence(row.rrule),
    };
    for (const occurrence of expandOccurrences(row, start, end)) {
      result.push({ ...base, ...occurrence });
    }
  }
  result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return result;
}

/**
 * FR-CAL-06: the private ICS feed's event list. Unlike listEventsInRange, recurring rows are
 * NOT expanded here - the feed emits each as its own RRULE master VEVENT and lets the
 * subscribing calendar app expand occurrences itself (that's what RRULE-in-ICS is for).
 * Bounded to recent/future/ongoing events so the feed doesn't grow unbounded: a one-off event
 * drops out 90 days after it starts, but a recurring series stays in regardless of how long ago
 * it began.
 */
export async function listAllVisibleEventsForFeed(
  database: Database,
  viewerId: string,
): Promise<EventView[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await database
    .select()
    .from(events)
    .where(or(gte(events.startsAt, ninetyDaysAgo), isNotNull(events.rrule)))
    .orderBy(asc(events.startsAt));

  const { visible, groupById } = await filterVisibleEventRows(database, rows, viewerId);
  const hostNameFor = await resolveHostNames(database, visible, groupById);

  const creatorIds = [...new Set(visible.map((row) => row.createdBy))];
  const creatorRows =
    creatorIds.length > 0
      ? await database
          .select({ id: users.id, displayName: users.displayName, avatarKey: users.avatarKey })
          .from(users)
          .where(inArray(users.id, creatorIds))
      : [];
  const creatorById = new Map(creatorRows.map((creator) => [creator.id, creator]));

  return visible.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    location: row.location,
    coverKey: row.coverKey,
    coverAltText: row.coverAltText,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    creatorDisplayName: creatorById.get(row.createdBy)?.displayName ?? "",
    creatorAvatarKey: creatorById.get(row.createdBy)?.avatarKey ?? null,
    hostType: row.hostType,
    hostId: row.hostId,
    hostName: hostNameFor(row),
    hostSlug: null,
    recurrence: rruleToRecurrence(row.rrule),
    rrule: row.rrule,
  }));
}

/** FR-CAL-07: tells every RSVP'd member (except the actor themselves) that an event they're going to or interested in changed. Must run before any delete - event_rsvps cascades on events.id. */
async function notifyRsvps(
  database: Database,
  eventId: string,
  eventTitle: string,
  actingUserId: string,
  type: "event_updated" | "event_cancelled",
) {
  const rsvpRows = await database
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), ne(eventRsvps.userId, actingUserId)));
  if (rsvpRows.length === 0) return;

  const [actor] = await database
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, actingUserId));
  const payload = {
    actorName: actor?.displayName ?? "Someone",
    eventTitle,
    targetId: eventId,
    targetType: "event",
  };
  await Promise.all(
    rsvpRows.map((rsvp) => createNotification(database, { userId: rsvp.userId, type, payload })),
  );
}

export interface UpdateEventInput {
  eventId: string;
  actingUserId: string;
  title: string;
  description?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  allDay: boolean;
  location?: string | undefined;
  recurrence?: EventRecurrence | undefined;
}

/** FR-CAL-07: creator-only. */
export async function updateEvent(database: Database, input: UpdateEventInput) {
  await requireEventCreator(database, input.eventId, input.actingUserId);
  const [row] = await database
    .update(events)
    .set({
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay,
      location: input.location ?? null,
      rrule: recurrenceToRrule(input.recurrence),
    })
    .where(eq(events.id, input.eventId))
    .returning();
  if (!row) throw new EventNotFoundError();
  await notifyRsvps(database, input.eventId, input.title, input.actingUserId, "event_updated");
  return row;
}

/** FR-CAL-12: the creator can cancel their own event; a site admin can delete anyone's (audited). Hard delete - events have no soft-delete/edit-history concern like posts do. */
export async function deleteEvent(database: Database, eventId: string, actingUserId: string) {
  const [existing] = await database.select().from(events).where(eq(events.id, eventId));
  if (!existing) throw new EventNotFoundError();

  if (existing.createdBy !== actingUserId) {
    await requireAdmin(database, actingUserId);
    await database.delete(events).where(eq(events.id, eventId));
    await writeAuditLog(database, {
      action: "delete_event",
      targetType: "event",
      targetId: eventId,
      actorId: actingUserId,
    });
    return;
  }

  // FR-CAL-07: a creator-initiated cancel notifies RSVPs; an admin moderation delete above
  // does not - that's content removal, not "the event you're going to changed".
  await notifyRsvps(database, eventId, existing.title, actingUserId, "event_cancelled");
  await database.delete(events).where(eq(events.id, eventId));
}

// ---- Comments (FR-CAL-10) - comment-service.ts's post-specific functions hardcode "post", so
// these are the event-scoped siblings; updateComment/deleteComment there are reused unchanged
// since they're keyed only by commentId. ----

export interface EventCommentItem {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
}

export async function listCommentsForEvent(
  database: Database,
  eventId: string,
): Promise<EventCommentItem[]> {
  return database
    .select({
      id: comments.id,
      body: comments.body,
      parentId: comments.parentId,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      authorId: comments.userId,
      authorDisplayName: users.displayName,
      authorAvatarKey: users.avatarKey,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.targetType, "event"), eq(comments.targetId, eventId)))
    .orderBy(asc(comments.createdAt));
}

export async function countCommentsForEvents(
  database: Database,
  eventIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (eventIds.length === 0) return map;

  const rows = await database
    .select({ targetId: comments.targetId })
    .from(comments)
    .where(and(eq(comments.targetType, "event"), inArray(comments.targetId, [...eventIds])));

  for (const row of rows) map.set(row.targetId, (map.get(row.targetId) ?? 0) + 1);
  return map;
}

export interface CreateEventCommentInput {
  eventId: string;
  userId: string;
  body: string;
  parentId?: string | undefined;
}

export async function createEventComment(database: Database, input: CreateEventCommentInput) {
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const [parent] = await database.select().from(comments).where(eq(comments.id, input.parentId));
    if (parent?.targetType !== "event" || parent.targetId !== input.eventId || parent.deletedAt) {
      throw new CommentNotFoundError("The comment you're replying to no longer exists.");
    }
    if (parent.parentId) throw new CommentReplyDepthError();
    parentAuthorId = parent.userId;
  }

  const [row] = await database
    .insert(comments)
    .values({
      targetType: "event",
      targetId: input.eventId,
      userId: input.userId,
      parentId: input.parentId ?? null,
      body: input.body,
    })
    .returning();
  if (!row) throw new Error("Failed to create comment");

  const [event] = await database
    .select({ createdBy: events.createdBy })
    .from(events)
    .where(eq(events.id, input.eventId));

  // FR-CAL-10/FR-NOT-01: the "creator notified" clause this comment component deferred in
  // task #26 (no Notifications system existed yet) is now live.
  await notifyAboutComment(database, {
    targetType: "event",
    targetId: input.eventId,
    ownerId: event?.createdBy ?? null,
    commenterId: input.userId,
    parentAuthorId,
    body: input.body,
  });

  return row;
}

// Re-exported so callers only need to import from event-service.ts for the whole comment flow.
export { CommentForbiddenError, CommentNotFoundError, CommentReplyDepthError };

// ---- Reactions - post-service.ts's attachReactions/setPostReaction/removePostReaction are
// private and hardcode "post", so these are the event-scoped siblings. ----

export type EventReactionCounts = Record<ReactionType, number>;

function emptyReactionCounts(): EventReactionCounts {
  return Object.fromEntries(reactionTypes.map((type) => [type, 0])) as EventReactionCounts;
}

export async function attachEventReactions(
  database: Database,
  eventIds: readonly string[],
  viewerId: string,
): Promise<{ counts: Map<string, EventReactionCounts>; mine: Map<string, ReactionType> }> {
  const counts = new Map<string, EventReactionCounts>();
  const mine = new Map<string, ReactionType>();
  if (eventIds.length === 0) return { counts, mine };

  const rows = await database
    .select({ targetId: reactions.targetId, userId: reactions.userId, type: reactions.type })
    .from(reactions)
    .where(and(eq(reactions.targetType, "event"), inArray(reactions.targetId, [...eventIds])));

  for (const row of rows) {
    const entry = counts.get(row.targetId) ?? emptyReactionCounts();
    entry[row.type] += 1;
    counts.set(row.targetId, entry);
    if (row.userId === viewerId) mine.set(row.targetId, row.type);
  }
  return { counts, mine };
}

export async function setEventReaction(
  database: Database,
  eventId: string,
  userId: string,
  type: ReactionType,
) {
  const [existing] = await database.select().from(events).where(eq(events.id, eventId));
  if (!existing) throw new EventNotFoundError();

  await database
    .insert(reactions)
    .values({ targetType: "event", targetId: eventId, userId, type })
    .onConflictDoUpdate({
      target: [reactions.targetType, reactions.targetId, reactions.userId],
      set: { type },
    });
}

export async function removeEventReaction(database: Database, eventId: string, userId: string) {
  await database
    .delete(reactions)
    .where(
      and(
        eq(reactions.targetType, "event"),
        eq(reactions.targetId, eventId),
        eq(reactions.userId, userId),
      ),
    );
}

// ---- RSVPs (FR-CAL-04) - one per member per event (the series, not a per-occurrence RSVP). ----

export interface RsvpCounts {
  going: number;
  interested: number;
}

export async function setEventRsvp(
  database: Database,
  eventId: string,
  userId: string,
  status: RsvpStatus,
) {
  const [existing] = await database.select().from(events).where(eq(events.id, eventId));
  if (!existing) throw new EventNotFoundError();

  await database
    .insert(eventRsvps)
    .values({ eventId, userId, status })
    .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status } });
}

export async function removeEventRsvp(database: Database, eventId: string, userId: string) {
  await database
    .delete(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
}

export async function getEventRsvps(
  database: Database,
  eventId: string,
  viewerId: string,
): Promise<{ counts: RsvpCounts; mine: RsvpStatus | null }> {
  const rows = await database
    .select({ userId: eventRsvps.userId, status: eventRsvps.status })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId));

  const counts: RsvpCounts = { going: 0, interested: 0 };
  let mine: RsvpStatus | null = null;
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.userId === viewerId) mine = row.status;
  }
  return { counts, mine };
}

// ---- Private ICS feed (FR-CAL-06) - only the token's hash is ever stored, same shape as
// invites.token_hash. The raw token is shown once, at generation time. ----

/** Always issues a fresh token, invalidating any previous one - same one-time-reveal UX as invite links. */
export async function regenerateCalendarFeedToken(
  database: Database,
  userId: string,
): Promise<string> {
  const token = generateCalendarFeedToken();
  await database
    .update(users)
    .set({ calendarFeedTokenHash: hashCalendarFeedToken(token) })
    .where(eq(users.id, userId));
  return token;
}

export async function hasCalendarFeedToken(database: Database, userId: string): Promise<boolean> {
  const [row] = await database
    .select({ calendarFeedTokenHash: users.calendarFeedTokenHash })
    .from(users)
    .where(eq(users.id, userId));
  return Boolean(row?.calendarFeedTokenHash);
}

/** Looked up by hash, same as invite tokens - the raw token is never persisted. */
export async function getUserIdForCalendarFeedToken(
  database: Database,
  token: string,
): Promise<string | null> {
  const [row] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.calendarFeedTokenHash, hashCalendarFeedToken(token)));
  return row?.id ?? null;
}
