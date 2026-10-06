import { describe, expect, it } from "vitest";

import { inviteAcceptSchema, inviteCreateSchema } from "./invite";

describe("inviteCreateSchema", () => {
  it("accepts a valid email with an optional note", () => {
    const result = inviteCreateSchema.parse({ email: "neighbor@example.com", note: "Hi!" });
    expect(result.email).toBe("neighbor@example.com");
  });

  it("accepts a valid email with no note", () => {
    expect(() => inviteCreateSchema.parse({ email: "neighbor@example.com" })).not.toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() => inviteCreateSchema.parse({ email: "nope" })).toThrow();
  });
});

describe("inviteAcceptSchema", () => {
  const base = { token: "a".repeat(43), displayName: "Jordan L.", password: "correct-horse" };

  it("accepts when the 18+ attestation is true", () => {
    expect(() => inviteAcceptSchema.parse({ ...base, isAdult: true })).not.toThrow();
  });

  it("rejects when the 18+ attestation is false", () => {
    expect(() => inviteAcceptSchema.parse({ ...base, isAdult: false })).toThrow();
  });

  it("rejects a token that's too short", () => {
    expect(() => inviteAcceptSchema.parse({ ...base, token: "short", isAdult: true })).toThrow();
  });
});
