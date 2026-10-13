import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { eventHostTypeEnum, rsvpStatusEnum } from "./enums";
import { users } from "./users";

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    // FR-CAL-02: optionally hosted by a group or business; null means member-hosted.
    hostType: eventHostTypeEnum("host_type"),
    hostId: uuid("host_id"),
    title: text("title").notNull(),
    description: text("description"),
    // FR-CAL-08: stored in UTC, displayed in America/Los_Angeles by the app.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // FR-CAL-01: distinguishes "an event at literal midnight" from "an all-day event" - the
    // timestamps alone can't tell those apart.
    allDay: boolean("all_day").notNull().default(false),
    // FR-CAL-05: a literal RRULE value (e.g. "FREQ=WEEKLY"), anchored at startsAt. null means
    // one-off.
    rrule: text("rrule"),
    location: text("location"),
    coverKey: text("cover_key"),
    coverAltText: text("cover_alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_starts_at_idx").on(t.startsAt)],
);

// FR-CAL-04: one RSVP per member per event - the series as a whole, not a per-occurrence RSVP
// (recurring events here are weekly/monthly only, with no per-occurrence edit/cancel UI).
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: rsvpStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_rsvps_unique").on(t.eventId, t.userId),
    index("event_rsvps_event_idx").on(t.eventId),
  ],
);
