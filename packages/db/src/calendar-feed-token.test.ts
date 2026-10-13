import { describe, expect, it } from "vitest";

import { generateCalendarFeedToken, hashCalendarFeedToken } from "./calendar-feed-token";

describe("generateCalendarFeedToken", () => {
  it("generates a sufficiently long, URL-safe token", () => {
    const token = generateCalendarFeedToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token each call", () => {
    expect(generateCalendarFeedToken()).not.toBe(generateCalendarFeedToken());
  });
});

describe("hashCalendarFeedToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateCalendarFeedToken();
    expect(hashCalendarFeedToken(token)).toBe(hashCalendarFeedToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashCalendarFeedToken(generateCalendarFeedToken())).not.toBe(
      hashCalendarFeedToken(generateCalendarFeedToken()),
    );
  });

  it("never returns the raw token itself", () => {
    const token = generateCalendarFeedToken();
    expect(hashCalendarFeedToken(token)).not.toBe(token);
  });
});
