import type { EventView } from "./event-service";

/** RFC 5545 §3.3.11: escape backslash, comma, semicolon and newlines in TEXT values. */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `YYYYMMDDTHHMMSSZ`, the UTC form RFC 5545 calls a "form #2" date-time. */
function formatUtcDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear().toString()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** `YYYYMMDD`, for an all-day event's `;VALUE=DATE` form - no time component at all. */
function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear().toString()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * One VEVENT for a single event. Recurring events (event.rrule set) emit the literal RRULE
 * line as their master - the subscribing calendar app expands occurrences itself, same as any
 * other recurring calendar subscription.
 */
export function eventToVevent(event: EventView): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@plumaslakelocals`,
    `DTSTAMP:${formatUtcDateTime(new Date())}`,
  ];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatUtcDate(event.startsAt)}`);
  } else {
    lines.push(`DTSTART:${formatUtcDateTime(event.startsAt)}`);
    if (event.endsAt) lines.push(`DTEND:${formatUtcDateTime(event.endsAt)}`);
  }

  if (event.rrule) lines.push(`RRULE:${event.rrule}`);
  lines.push(`SUMMARY:${icsEscape(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

/** Wraps one or more VEVENTs in a VCALENDAR, CRLF line endings per RFC 5545. */
export function buildIcsCalendar(vevents: readonly string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Plumas Lake Locals//Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n");
}
