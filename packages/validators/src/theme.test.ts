import { describe, expect, it } from "vitest";

import { setThemeSchema, themeSchema } from "./theme";

describe("themeSchema", () => {
  it("accepts each of the three built-in themes", () => {
    expect(themeSchema.parse("system")).toBe("system");
    expect(themeSchema.parse("light")).toBe("light");
    expect(themeSchema.parse("dark")).toBe("dark");
  });

  it("rejects anything else", () => {
    expect(() => themeSchema.parse("midnight")).toThrow();
  });
});

describe("setThemeSchema", () => {
  it("accepts a valid theme payload", () => {
    expect(() => setThemeSchema.parse({ theme: "dark" })).not.toThrow();
  });

  it("rejects a missing theme", () => {
    expect(() => setThemeSchema.parse({})).toThrow();
  });
});
