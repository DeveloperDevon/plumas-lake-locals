import {
  attachEventReactions,
  countCommentsForEvents,
  createEvent,
  createEventComment,
  deleteComment,
  deleteEvent,
  getEventById,
  getEventRsvps,
  listCommentsForEvent,
  listEventsInRange,
  regenerateCalendarFeedToken,
  removeEventReaction,
  removeEventRsvp,
  setEventReaction,
  setEventRsvp,
  updateComment,
  updateEvent,
} from "@plumas/auth";
import {
  createEventCommentSchema,
  createEventSchema,
  eventIdSchema,
  listEventsInRangeSchema,
  setEventReactionSchema,
  setEventRsvpSchema,
  updateCommentSchema,
  updateEventSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

/**
 * FR-CAL-11: returns null (never throws) for an event the viewer can't see - the route's own
 * loader turns that into notFound(), same reasoning as getGroupBySlugFn/getBusinessBySlugFn.
 */
export const getEventByIdFn = createServerFn({ method: "GET" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getEventById(getDb(), data.eventId, user.id);
  });

export const getEventsInRangeFn = createServerFn({ method: "GET" })
  .validator(listEventsInRangeSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listEventsInRange(getDb(), {
      start: new Date(data.start),
      end: new Date(data.end),
      viewerId: user.id,
    });
  });

export const createEventFn = createServerFn({ method: "POST" })
  .validator(createEventSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createEvent(getDb(), {
      createdBy: user.id,
      title: data.title,
      description: data.description,
      startsAt: new Date(data.startsAt),
      endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
      allDay: data.allDay,
      location: data.location,
      hostType: data.hostType,
      hostId: data.hostId,
      recurrence: data.recurrence,
    });
  });

export const updateEventFn = createServerFn({ method: "POST" })
  .validator(updateEventSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateEvent(getDb(), {
      eventId: data.eventId,
      actingUserId: user.id,
      title: data.title,
      description: data.description,
      startsAt: new Date(data.startsAt),
      endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
      allDay: data.allDay,
      location: data.location,
      recurrence: data.recurrence,
    });
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteEvent(getDb(), data.eventId, user.id);
    return { ok: true as const };
  });

export const getEventCommentsFn = createServerFn({ method: "GET" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    return listCommentsForEvent(getDb(), data.eventId);
  });

export const getEventCommentCountsFn = createServerFn({ method: "GET" })
  .validator(z.object({ eventIds: z.array(z.string().uuid()) }))
  .handler(async ({ data }) => {
    await requireUser();
    const counts = await countCommentsForEvents(getDb(), data.eventIds);
    return Object.fromEntries(counts);
  });

export const createEventCommentFn = createServerFn({ method: "POST" })
  .validator(createEventCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createEventComment(getDb(), { ...data, userId: user.id });
  });

export const updateEventCommentFn = createServerFn({ method: "POST" })
  .validator(updateCommentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return updateComment(getDb(), { ...data, userId: user.id });
  });

export const deleteEventCommentFn = createServerFn({ method: "POST" })
  .validator(z.object({ commentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await deleteComment(getDb(), data.commentId, user.id);
    return { ok: true as const };
  });

export const getEventReactionsFn = createServerFn({ method: "GET" })
  .validator(z.object({ eventIds: z.array(z.string().uuid()) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { counts, mine } = await attachEventReactions(getDb(), data.eventIds, user.id);
    return {
      counts: Object.fromEntries(counts),
      mine: Object.fromEntries(mine),
    };
  });

export const setEventReactionFn = createServerFn({ method: "POST" })
  .validator(setEventReactionSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setEventReaction(getDb(), data.eventId, user.id, data.type);
    return { ok: true as const };
  });

export const removeEventReactionFn = createServerFn({ method: "POST" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removeEventReaction(getDb(), data.eventId, user.id);
    return { ok: true as const };
  });

export const getEventRsvpsFn = createServerFn({ method: "GET" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getEventRsvps(getDb(), data.eventId, user.id);
  });

export const setEventRsvpFn = createServerFn({ method: "POST" })
  .validator(setEventRsvpSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await setEventRsvp(getDb(), data.eventId, user.id, data.status);
    return { ok: true as const };
  });

export const removeEventRsvpFn = createServerFn({ method: "POST" })
  .validator(eventIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removeEventRsvp(getDb(), data.eventId, user.id);
    return { ok: true as const };
  });

/** FR-CAL-06: returns the raw token once - only its hash is ever stored. */
export const regenerateCalendarFeedTokenFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await requireUser();
    const token = await regenerateCalendarFeedToken(getDb(), user.id);
    return { token };
  },
);
