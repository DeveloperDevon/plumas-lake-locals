import { describe, expect, it } from "vitest";

import { reactionTypeSchema, removeReactionSchema, setReactionSchema } from "./reaction";

describe("reactionTypeSchema", () => {
  it("accepts each of the 5 reaction types", () => {
    for (const type of ["like", "love", "laugh", "sad", "helpful"]) {
      expect(reactionTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects anything else", () => {
    expect(() => reactionTypeSchema.parse("angry")).toThrow();
  });
});

describe("setReactionSchema", () => {
  it("accepts a postId and type", () => {
    expect(() =>
      setReactionSchema.parse({ postId: crypto.randomUUID(), type: "like" }),
    ).not.toThrow();
  });

  it("rejects a missing type", () => {
    expect(() => setReactionSchema.parse({ postId: crypto.randomUUID() })).toThrow();
  });
});

describe("removeReactionSchema", () => {
  it("accepts a postId", () => {
    expect(() => removeReactionSchema.parse({ postId: crypto.randomUUID() })).not.toThrow();
  });

  it("rejects a missing postId", () => {
    expect(() => removeReactionSchema.parse({})).toThrow();
  });
});
