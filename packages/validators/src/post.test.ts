import { describe, expect, it } from "vitest";

import { createPostSchema, postBodySchema, postCategorySchema, updatePostSchema } from "./post";

describe("postCategorySchema", () => {
  it("accepts each of the four built-in categories", () => {
    expect(postCategorySchema.parse("general")).toBe("general");
    expect(postCategorySchema.parse("lost_found")).toBe("lost_found");
    expect(postCategorySchema.parse("safety")).toBe("safety");
    expect(postCategorySchema.parse("recommendations")).toBe("recommendations");
  });

  it("rejects anything else", () => {
    expect(() => postCategorySchema.parse("events")).toThrow();
  });
});

describe("postBodySchema", () => {
  it("accepts a normal body, trimmed", () => {
    expect(postBodySchema.parse("  Hello neighbors  ")).toBe("Hello neighbors");
  });

  it("rejects an empty body", () => {
    expect(() => postBodySchema.parse("")).toThrow();
    expect(() => postBodySchema.parse("   ")).toThrow();
  });

  it("rejects a body over 5,000 characters (FR-FEED-01)", () => {
    expect(() => postBodySchema.parse("a".repeat(5001))).toThrow();
    expect(() => postBodySchema.parse("a".repeat(5000))).not.toThrow();
  });
});

describe("createPostSchema", () => {
  it("accepts a body with no category", () => {
    expect(() => createPostSchema.parse({ body: "Hello" })).not.toThrow();
  });

  it("accepts a body with a category", () => {
    expect(() => createPostSchema.parse({ body: "Hello", category: "safety" })).not.toThrow();
  });

  it("rejects a missing body", () => {
    expect(() => createPostSchema.parse({})).toThrow();
  });
});

describe("updatePostSchema", () => {
  it("requires a postId", () => {
    expect(() => updatePostSchema.parse({ body: "Hello" })).toThrow();
    expect(() =>
      updatePostSchema.parse({ postId: crypto.randomUUID(), body: "Hello" }),
    ).not.toThrow();
  });
});
