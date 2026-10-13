/**
 * `Date#toLocaleString`/`toLocaleDateString` with no explicit locale/timeZone resolve the
 * environment's default - the server (container, usually UTC) and the client (the browser's
 * own timezone) disagree, which React treats as a hydration mismatch on every SSR-ed
 * timestamp. Pinning both here makes the string identical in both environments.
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: "UTC" });
}

export function formatDate(
  date: Date,
  options?: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): string {
  return date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** FR-CAL-08: events display in America/Los_Angeles, unlike every other UTC-pinned timestamp above. */
export function formatEventTime(
  date: Date,
  options?: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
    timeZone: "America/Los_Angeles",
  });
}

export function formatEventDate(
  date: Date,
  options?: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): string {
  return date.toLocaleDateString("en-US", {
    ...options,
    timeZone: "America/Los_Angeles",
  });
}

/**
 * Converts a `<input type="datetime-local">` value (a naive "YYYY-MM-DDTHH:mm" wall-clock
 * string with no timezone, meant as Pacific time) into the UTC instant it actually represents.
 *
 * No timezone library needed: formatting an instant in both zones and diffing gives the real
 * Pacific UTC offset *at that instant*, DST-correct, straight from Intl's own tz database. A
 * single pass samples the offset at the naive "as if UTC" instant, which is wrong right around
 * a DST boundary - that instant and the real Pacific instant (seven or eight hours apart) can
 * straddle the transition and land on opposite sides of it. A second pass resamples the offset
 * at the corrected instant, which converges since the offset only takes two values.
 */
export function pacificWallClockToUtc(dateTimeLocal: string): Date {
  const naive = new Date(`${dateTimeLocal}Z`);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const pacific = new Date(guess.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    guess = new Date(naive.getTime() + (utc.getTime() - pacific.getTime()));
  }
  return guess;
}

/** The inverse of pacificWallClockToUtc - for pre-filling a datetime-local input from a stored UTC instant. */
export function utcToPacificWallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
