import { describe, expect, it } from "vitest";

import { pacificWallClockToUtc, utcToPacificWallClock } from "./format-date";

describe("pacificWallClockToUtc", () => {
  it("converts a winter (PST, UTC-8) wall-clock time correctly", () => {
    // Jan 15, 2026, 9:00 AM Pacific Standard Time -> 17:00 UTC.
    const result = pacificWallClockToUtc("2026-01-15T09:00");
    expect(result.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("converts a summer (PDT, UTC-7) wall-clock time correctly", () => {
    // Jul 15, 2026, 9:00 AM Pacific Daylight Time -> 16:00 UTC.
    const result = pacificWallClockToUtc("2026-07-15T09:00");
    expect(result.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("is correct just after the spring-forward transition (2026-03-08 2:00 AM -> 3:00 AM)", () => {
    // 3:30 AM Pacific on spring-forward day is already PDT (UTC-7).
    const result = pacificWallClockToUtc("2026-03-08T03:30");
    expect(result.toISOString()).toBe("2026-03-08T10:30:00.000Z");
  });

  it("is correct just before the fall-back transition (2026-11-01 2:00 AM -> 1:00 AM)", () => {
    // 1:30 AM the morning before fall-back is still PDT (UTC-7) in 2026.
    const beforeFallBack = pacificWallClockToUtc("2026-10-31T01:30");
    expect(beforeFallBack.toISOString()).toBe("2026-10-31T08:30:00.000Z");

    // Noon the day after fall-back is PST (UTC-8).
    const afterFallBack = pacificWallClockToUtc("2026-11-01T12:00");
    expect(afterFallBack.toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });

  it("round-trips through utcToPacificWallClock", () => {
    const original = "2026-07-04T18:30";
    const utc = pacificWallClockToUtc(original);
    expect(utcToPacificWallClock(utc)).toBe(original);
  });
});
