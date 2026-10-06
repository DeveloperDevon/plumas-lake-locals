import { describe, expect, it } from "vitest";

import { emailSchema } from "./common";

describe("emailSchema", () => {
  it("trims and lowercases a valid email", () => {
    expect(emailSchema.parse("  Jordan@Example.com  ")).toBe("jordan@example.com");
  });

  it("rejects an invalid email", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
});
