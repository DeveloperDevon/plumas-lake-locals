import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createBusiness } from "./business-service";
import {
  createEvent,
  createEventComment,
  deleteEvent,
  EventForbiddenError,
  getEventById,
  listCommentsForEvent,
  listEventsInRange,
  removeEventReaction,
  setEventReaction,
  updateEvent,
} from "./event-service";
import { acceptGroupInvite, createGroup, GroupForbiddenError, inviteMember } from "./group-service";
import { listAuditLog } from "./moderation-service";

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
});
