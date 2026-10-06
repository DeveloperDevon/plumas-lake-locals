import { describe, expect, it } from "vitest";

import { generateInviteToken, hashInviteToken } from "./invite-token";

describe("generateInviteToken", () => {
  it("generates a sufficiently long, URL-safe token", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });
});

describe("hashInviteToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashInviteToken(generateInviteToken())).not.toBe(hashInviteToken(generateInviteToken()));
  });

  it("never returns the raw token itself", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).not.toBe(token);
  });
});
