import { describe, expect, it } from "vitest";

import type { EventView } from "./event-service";
import { buildIcsCalendar, eventToVevent, icsEscape } from "./ics";

function baseEvent(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Block party",
    description: "Bring folding chairs",
    startsAt: new Date("2026-10-24T23:00:00Z"),
    endsAt: new Date("2026-10-25T02:00:00Z"),
    allDay: false,
    location: "Plumas Lake Elementary lot",
    coverKey: null,
    coverAltText: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    createdBy: "22222222-2222-2222-2222-222222222222",
    creatorDisplayName: "Jordan L.",
    creatorAvatarKey: null,
    hostType: null,
    hostId: null,
    hostName: null,
    hostSlug: null,
    recurrence: "none",
    rrule: null,
    ...overrides,
  };
}

describe("icsEscape", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(icsEscape("Bring chairs, please; thanks\\ a lot\nSee you there")).toBe(
      "Bring chairs\\, please\\; thanks\\\\ a lot\\nSee you there",
    );
  });
});

describe("eventToVevent", () => {
  it("includes UID, DTSTART/DTEND in UTC, SUMMARY, DESCRIPTION and LOCATION", () => {
    const vevent = eventToVevent(baseEvent());
    expect(vevent).toContain("BEGIN:VEVENT");
    expect(vevent).toContain("UID:11111111-1111-1111-1111-111111111111@plumaslakelocals");
    expect(vevent).toContain("DTSTART:20261024T230000Z");
    expect(vevent).toContain("DTEND:20261025T020000Z");
    expect(vevent).toContain("SUMMARY:Block party");
    expect(vevent).toContain("DESCRIPTION:Bring folding chairs");
    expect(vevent).toContain("LOCATION:Plumas Lake Elementary lot");
    expect(vevent).toContain("END:VEVENT");
    expect(vevent).not.toContain("RRULE");
  });

  it("uses a bare VALUE=DATE for all-day events, no time component", () => {
    const vevent = eventToVevent(baseEvent({ allDay: true, endsAt: null }));
    expect(vevent).toContain("DTSTART;VALUE=DATE:20261024");
    expect(vevent).not.toContain("DTEND");
  });

  it("includes the literal RRULE line for a recurring event", () => {
    const vevent = eventToVevent(baseEvent({ recurrence: "weekly", rrule: "FREQ=WEEKLY" }));
    expect(vevent).toContain("RRULE:FREQ=WEEKLY");
  });

  it("omits DESCRIPTION/LOCATION when absent", () => {
    const vevent = eventToVevent(baseEvent({ description: null, location: null }));
    expect(vevent).not.toContain("DESCRIPTION");
    expect(vevent).not.toContain("LOCATION");
  });
});

describe("buildIcsCalendar", () => {
  it("wraps VEVENTs in a VCALENDAR with CRLF line endings", () => {
    const calendar = buildIcsCalendar([eventToVevent(baseEvent())]);
    expect(calendar.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(calendar).toContain("PRODID:-//Plumas Lake Locals//Calendar//EN");
    expect(calendar.endsWith("END:VCALENDAR")).toBe(true);
    expect(calendar).toContain("BEGIN:VEVENT");
  });

  it("includes every event passed in", () => {
    const calendar = buildIcsCalendar([
      eventToVevent(baseEvent({ id: "a" })),
      eventToVevent(baseEvent({ id: "b" })),
    ]);
    expect(calendar).toContain("UID:a@plumaslakelocals");
    expect(calendar).toContain("UID:b@plumaslakelocals");
  });
});
