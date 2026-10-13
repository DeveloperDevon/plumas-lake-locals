import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createBusiness } from "./business-service";
import {
  createEvent,
  createEventComment,
  deleteEvent,
  EventForbiddenError,
  getEventById,
  getEventRsvps,
  getUserIdForCalendarFeedToken,
  hasCalendarFeedToken,
  listAllVisibleEventsForFeed,
  listCommentsForEvent,
  listEventsInRange,
  regenerateCalendarFeedToken,
  removeEventReaction,
  removeEventRsvp,
  setEventReaction,
  setEventRsvp,
  updateEvent,
} from "./event-service";
import { acceptGroupInvite, createGroup, GroupForbiddenError, inviteMember } from "./group-service";
import { listAuditLog } from "./moderation-service";
import { listNotificationsForUser } from "./notification-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("event-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string, role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}`, role })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a member-hosted event and returns it to any signed-in viewer", async () => {
    const creator = await makeMember("creator-basic");
    const viewer = await makeMember("viewer-basic");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Block party",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    const view = await getEventById(db, event.id, viewer.id);
    expect(view?.title).toBe("Block party");
    expect(view?.creatorDisplayName).toBe(creator.displayName);
    expect(view?.hostType).toBeNull();
  });

  it("requires active group membership to host an event under a group", async () => {
    const owner = await makeMember("owner-host-group");
    const outsider = await makeMember("outsider-host-group");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Farmers Market",
      visibility: "public",
    });

    await expect(
      createEvent(db, {
        createdBy: outsider.id,
        title: "Saturday market",
        startsAt: new Date("2026-10-24T15:00:00Z"),
        allDay: false,
        hostType: "group",
        hostId: group.id,
      }),
    ).rejects.toThrow(GroupForbiddenError);

    const event = await createEvent(db, {
      createdBy: owner.id,
      title: "Saturday market",
      startsAt: new Date("2026-10-24T15:00:00Z"),
      allDay: false,
      hostType: "group",
      hostId: group.id,
    });
    const view = await getEventById(db, event.id, owner.id);
    expect(view?.hostName).toBe("Farmers Market");
  });

  it("requires a manager role to host an event under a business", async () => {
    const owner = await makeMember("owner-host-biz");
    const outsider = await makeMember("outsider-host-biz");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Sam's Grooming",
      serviceArea: "Plumas Lake",
    });

    await expect(
      createEvent(db, {
        createdBy: outsider.id,
        title: "Open house",
        startsAt: new Date("2026-10-24T15:00:00Z"),
        allDay: false,
        hostType: "business",
        hostId: business.id,
      }),
    ).rejects.toThrow();

    const event = await createEvent(db, {
      createdBy: owner.id,
      title: "Open house",
      startsAt: new Date("2026-10-24T15:00:00Z"),
      allDay: false,
      hostType: "business",
      hostId: business.id,
    });
    const view = await getEventById(db, event.id, owner.id);
    expect(view?.hostName).toBe("Sam's Grooming");
  });

  it("hides a private group's event from a non-member via both getEventById and listEventsInRange", async () => {
    const owner = await makeMember("owner-private-evt");
    const member = await makeMember("member-private-evt");
    const outsider = await makeMember("outsider-private-evt");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Secret Club",
      visibility: "private",
    });
    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);

    const startsAt = new Date("2026-12-01T20:00:00Z");
    const event = await createEvent(db, {
      createdBy: owner.id,
      title: "Secret gathering",
      startsAt,
      allDay: false,
      hostType: "group",
      hostId: group.id,
    });

    expect(await getEventById(db, event.id, outsider.id)).toBeNull();
    expect((await getEventById(db, event.id, member.id))?.id).toBe(event.id);
    expect((await getEventById(db, event.id, owner.id))?.id).toBe(event.id);

    const range = {
      start: new Date("2026-11-30T00:00:00Z"),
      end: new Date("2026-12-02T00:00:00Z"),
    };
    const outsiderList = await listEventsInRange(db, { ...range, viewerId: outsider.id });
    expect(outsiderList.some((row) => row.id === event.id)).toBe(false);

    const memberList = await listEventsInRange(db, { ...range, viewerId: member.id });
    expect(memberList.some((row) => row.id === event.id)).toBe(true);
  });

  it("only the creator can update an event", async () => {
    const creator = await makeMember("creator-update");
    const other = await makeMember("other-update");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Original title",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    await expect(
      updateEvent(db, {
        eventId: event.id,
        actingUserId: other.id,
        title: "Hijacked",
        startsAt: event.startsAt,
        allDay: false,
      }),
    ).rejects.toThrow(EventForbiddenError);

    const updated = await updateEvent(db, {
      eventId: event.id,
      actingUserId: creator.id,
      title: "Updated title",
      startsAt: event.startsAt,
      allDay: false,
    });
    expect(updated.title).toBe("Updated title");
  });

  it("lets the creator cancel their own event, and blocks a non-creator non-admin", async () => {
    const creator = await makeMember("creator-cancel");
    const other = await makeMember("other-cancel");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Cancel me",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    await expect(deleteEvent(db, event.id, other.id)).rejects.toThrow(EventForbiddenError);

    await deleteEvent(db, event.id, creator.id);
    expect(await getEventById(db, event.id, creator.id)).toBeNull();
  });

  it("lets a site admin delete someone else's event, and audit-logs it", async () => {
    const creator = await makeMember("creator-admin-del");
    const admin = await makeMember("admin-admin-del", "admin");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Admin will delete this",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    await deleteEvent(db, event.id, admin.id);
    expect(await getEventById(db, event.id, creator.id)).toBeNull();

    const logged = await listAuditLog(db, admin.id, 50);
    expect(logged.some((row) => row.targetId === event.id && row.action === "delete_event")).toBe(
      true,
    );
  });

  it("supports commenting and reacting on an event", async () => {
    const creator = await makeMember("creator-comments");
    const commenter = await makeMember("commenter-comments");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Comment on me",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    await createEventComment(db, {
      eventId: event.id,
      userId: commenter.id,
      body: "We'll bring folding chairs.",
    });
    const comments = await listCommentsForEvent(db, event.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("We'll bring folding chairs.");

    await setEventReaction(db, event.id, commenter.id, "like");
    await removeEventReaction(db, event.id, commenter.id);
  });

  it("supports going/interested RSVPs, switching between them, and removing one", async () => {
    const creator = await makeMember("creator-rsvp");
    const alice = await makeMember("alice-rsvp");
    const bob = await makeMember("bob-rsvp");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "RSVP me",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });

    await setEventRsvp(db, event.id, alice.id, "going");
    await setEventRsvp(db, event.id, bob.id, "interested");
    let rsvps = await getEventRsvps(db, event.id, alice.id);
    expect(rsvps.counts).toEqual({ going: 1, interested: 1 });
    expect(rsvps.mine).toBe("going");

    // Switching status is an upsert, not a second row.
    await setEventRsvp(db, event.id, alice.id, "interested");
    rsvps = await getEventRsvps(db, event.id, alice.id);
    expect(rsvps.counts).toEqual({ going: 0, interested: 2 });

    await removeEventRsvp(db, event.id, bob.id);
    rsvps = await getEventRsvps(db, event.id, creator.id);
    expect(rsvps.counts).toEqual({ going: 0, interested: 1 });
    expect(rsvps.mine).toBeNull();
  });

  it("expands a weekly and a monthly recurring event into their occurrences inside the queried range", async () => {
    const creator = await makeMember("creator-recur");
    const viewer = await makeMember("viewer-recur");

    const weekly = await createEvent(db, {
      createdBy: creator.id,
      title: "Farmers Market",
      startsAt: new Date("2026-11-07T16:00:00Z"), // a Saturday
      allDay: false,
      recurrence: "weekly",
    });
    const monthly = await createEvent(db, {
      createdBy: creator.id,
      title: "HOA meeting",
      startsAt: new Date("2026-11-03T02:00:00Z"),
      allDay: false,
      recurrence: "monthly",
    });

    const range = {
      start: new Date("2026-11-01T00:00:00Z"),
      end: new Date("2026-12-01T00:00:00Z"),
      viewerId: viewer.id,
    };
    const rows = await listEventsInRange(db, range);

    const weeklyOccurrences = rows.filter((row) => row.id === weekly.id);
    expect(weeklyOccurrences).toHaveLength(4); // Nov 7, 14, 21, 28
    expect(weeklyOccurrences[0]?.recurrence).toBe("weekly");
    expect(weeklyOccurrences.map((row) => row.startsAt.getUTCDate())).toEqual([7, 14, 21, 28]);

    const monthlyOccurrences = rows.filter((row) => row.id === monthly.id);
    expect(monthlyOccurrences).toHaveLength(1); // only Nov 3 falls in this one-month window
    expect(monthlyOccurrences[0]?.recurrence).toBe("monthly");
  });

  it("respects private-group visibility for a recurring event's occurrences too", async () => {
    const owner = await makeMember("owner-recur-private");
    const member = await makeMember("member-recur-private");
    const outsider = await makeMember("outsider-recur-private");
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: "Weekly Watch",
      visibility: "private",
    });
    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);

    const event = await createEvent(db, {
      createdBy: owner.id,
      title: "Weekly patrol",
      startsAt: new Date("2026-11-07T20:00:00Z"),
      allDay: false,
      hostType: "group",
      hostId: group.id,
      recurrence: "weekly",
    });

    // Other tests in this file create their own (public) events in this same date range, so
    // this checks for this specific event's id, not an empty result.
    const range = {
      start: new Date("2026-11-01T00:00:00Z"),
      end: new Date("2026-12-01T00:00:00Z"),
    };
    const outsiderRows = await listEventsInRange(db, { ...range, viewerId: outsider.id });
    expect(outsiderRows.some((row) => row.id === event.id)).toBe(false);

    const memberRows = await listEventsInRange(db, { ...range, viewerId: member.id });
    const memberOccurrences = memberRows.filter((row) => row.id === event.id);
    expect(memberOccurrences.length).toBeGreaterThan(1);
  });

  it("notifies RSVP'd members (not the actor) when an event is updated or cancelled", async () => {
    const creator = await makeMember("creator-notify-rsvp");
    const alice = await makeMember("alice-notify-rsvp");
    const bob = await makeMember("bob-notify-rsvp");
    const event = await createEvent(db, {
      createdBy: creator.id,
      title: "Block party",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });
    await setEventRsvp(db, event.id, alice.id, "going");
    await setEventRsvp(db, event.id, creator.id, "going"); // the actor RSVPing to their own event

    await updateEvent(db, {
      eventId: event.id,
      actingUserId: creator.id,
      title: "Block party (moved)",
      startsAt: event.startsAt,
      allDay: false,
    });
    const aliceAfterUpdate = await listNotificationsForUser(db, { userId: alice.id, limit: 10 });
    expect(aliceAfterUpdate.items.some((item) => item.type === "event_updated")).toBe(true);
    const creatorAfterUpdate = await listNotificationsForUser(db, {
      userId: creator.id,
      limit: 10,
    });
    expect(creatorAfterUpdate.items.some((item) => item.type === "event_updated")).toBe(false);

    await deleteEvent(db, event.id, creator.id);
    const aliceAfterCancel = await listNotificationsForUser(db, { userId: alice.id, limit: 10 });
    expect(aliceAfterCancel.items.some((item) => item.type === "event_cancelled")).toBe(true);

    // bob never RSVP'd - no notification of either kind.
    const bobNotifications = await listNotificationsForUser(db, { userId: bob.id, limit: 10 });
    expect(bobNotifications.items.some((item) => item.type === "event_updated")).toBe(false);
    expect(bobNotifications.items.some((item) => item.type === "event_cancelled")).toBe(false);
  });

  it("issues a private calendar feed token, looks it up by hash, and lists visible events for it", async () => {
    const owner = await makeMember("owner-feed");
    expect(await hasCalendarFeedToken(db, owner.id)).toBe(false);

    const token = await regenerateCalendarFeedToken(db, owner.id);
    expect(await hasCalendarFeedToken(db, owner.id)).toBe(true);
    expect(await getUserIdForCalendarFeedToken(db, token)).toBe(owner.id);
    expect(await getUserIdForCalendarFeedToken(db, "not-a-real-token")).toBeNull();

    // A fresh token invalidates the old one.
    const secondToken = await regenerateCalendarFeedToken(db, owner.id);
    expect(await getUserIdForCalendarFeedToken(db, token)).toBeNull();
    expect(await getUserIdForCalendarFeedToken(db, secondToken)).toBe(owner.id);

    await createEvent(db, {
      createdBy: owner.id,
      title: "Feed me",
      startsAt: new Date("2026-10-24T23:00:00Z"),
      allDay: false,
    });
    const feed = await listAllVisibleEventsForFeed(db, owner.id);
    expect(feed.some((event) => event.title === "Feed me")).toBe(true);
  });
});
