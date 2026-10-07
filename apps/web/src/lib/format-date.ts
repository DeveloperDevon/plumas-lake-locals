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
