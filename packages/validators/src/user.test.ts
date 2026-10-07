import { describe, expect, it } from "vitest";

import {
  birthdayDaySchema,
  birthdayMonthSchema,
  fieldVisibilitySchema,
  interestsSchema,
  profileVisibilitySchema,
  userProfileSchema,
} from "./user";

describe("interestsSchema", () => {
  it("accepts up to 10 trimmed tags", () => {
    const result = interestsSchema.parse([" hiking ", "gardening"]);
    expect(result).toEqual(["hiking", "gardening"]);
  });

  it("rejects more than 10 tags", () => {
    expect(() =>
      interestsSchema.parse(Array.from({ length: 11 }, (_, i) => `tag${i.toString()}`)),
    ).toThrow();
  });

  it("rejects an empty tag", () => {
    expect(() => interestsSchema.parse([""])).toThrow();
  });
});

describe("birthdayMonthSchema / birthdayDaySchema", () => {
  it("accepts valid ranges", () => {
    expect(birthdayMonthSchema.parse(12)).toBe(12);
    expect(birthdayDaySchema.parse(31)).toBe(31);
  });

  it("rejects out-of-range values", () => {
    expect(() => birthdayMonthSchema.parse(13)).toThrow();
    expect(() => birthdayMonthSchema.parse(0)).toThrow();
    expect(() => birthdayDaySchema.parse(32)).toThrow();
  });
});

describe("profileVisibilitySchema / fieldVisibilitySchema", () => {
  it("accepts the two visibility values", () => {
    expect(profileVisibilitySchema.parse("all")).toBe("all");
    expect(profileVisibilitySchema.parse("connections")).toBe("connections");
  });

  it("rejects anything else", () => {
    expect(() => profileVisibilitySchema.parse("friends")).toThrow();
  });

  it("accepts a partial map covering only some fields", () => {
    expect(() => fieldVisibilitySchema.parse({ interests: "connections" })).not.toThrow();
  });
});

describe("userProfileSchema", () => {
  it("accepts a full payload", () => {
    expect(() =>
      userProfileSchema.parse({
        displayName: "Jordan L.",
        bio: "Neighbor since 2020.",
        street: "Oak St.",
        interests: ["hiking"],
        occupation: "Teacher",
        pets: "One dog",
        website: "example.com",
        birthdayMonth: 6,
        birthdayDay: 15,
        fieldVisibility: { occupation: "connections" },
      }),
    ).not.toThrow();
  });

  it("requires a non-empty displayName and nothing else", () => {
    expect(() => userProfileSchema.parse({ displayName: "Jordan L." })).not.toThrow();
    expect(() => userProfileSchema.parse({ displayName: "" })).toThrow();
  });
});
