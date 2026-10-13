import { z } from "zod";

import { commentBodySchema } from "./comment";
import { uuidSchema } from "./common";
import { reactionTypeSchema } from "./reaction";

/** FR-CAL-02: an event can be hosted by a group or a business page, or go unhosted (member-only). */
export const eventHostTypes = ["group", "business"] as const;
export type EventHostType = (typeof eventHostTypes)[number];
export const eventHostTypeSchema = z.enum(eventHostTypes);

export const eventTitleSchema = z.string().trim().min(1).max(150);
export const eventDescriptionSchema = z.string().trim().max(2000);
export const eventLocationSchema = z.string().trim().max(200);

/** FR-CAL-05: weekly/monthly only, matching the PRD's exact wording - no custom RRULE input. */
export const eventRecurrenceValues = ["none", "weekly", "monthly"] as const;
export type EventRecurrence = (typeof eventRecurrenceValues)[number];
export const eventRecurrenceSchema = z.enum(eventRecurrenceValues);

/** FR-CAL-04. */
export const rsvpStatuses = ["going", "interested"] as const;
export type RsvpStatus = (typeof rsvpStatuses)[number];
export const rsvpStatusSchema = z.enum(rsvpStatuses);

const eventHostFields = z.object({
  hostType: eventHostTypeSchema.optional(),
  hostId: uuidSchema.optional(),
});

/** Both present or both absent - a host type with no id (or vice versa) is meaningless. */
function refineHostPair(input: z.infer<typeof eventHostFields>, ctx: z.RefinementCtx) {
  if (Boolean(input.hostType) !== Boolean(input.hostId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "hostType and hostId must be given together.",
      path: ["hostId"],
    });
  }
}

export const createEventSchema = z
  .object({
    title: eventTitleSchema,
    description: eventDescriptionSchema.optional(),
    // ISO strings over the wire - the server converts to Date.
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    allDay: z.boolean().default(false),
    location: eventLocationSchema.optional(),
    recurrence: eventRecurrenceSchema.optional(),
  })
  .merge(eventHostFields)
  .superRefine(refineHostPair);
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  eventId: uuidSchema,
  title: eventTitleSchema,
  description: eventDescriptionSchema.optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  location: eventLocationSchema.optional(),
  recurrence: eventRecurrenceSchema.optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsInRangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});
export type ListEventsInRangeInput = z.infer<typeof listEventsInRangeSchema>;

export const eventIdSchema = z.object({ eventId: uuidSchema });

export const createEventCommentSchema = z.object({
  eventId: uuidSchema,
  body: commentBodySchema,
  parentId: uuidSchema.optional(),
});
export type CreateEventCommentInput = z.infer<typeof createEventCommentSchema>;

export const setEventReactionSchema = z.object({
  eventId: uuidSchema,
  type: reactionTypeSchema,
});
export type SetEventReactionInput = z.infer<typeof setEventReactionSchema>;

export const setEventRsvpSchema = z.object({
  eventId: uuidSchema,
  status: rsvpStatusSchema,
});
export type SetEventRsvpInput = z.infer<typeof setEventRsvpSchema>;
