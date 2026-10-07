import { describe, expect, it } from "vitest";

import { commentBodySchema, createCommentSchema, updateCommentSchema } from "./comment";

describe("commentBodySchema", () => {
  it("accepts a normal body, trimmed", () => {
    expect(commentBodySchema.parse("  Hello  ")).toBe("Hello");
  });

  it("rejects an empty body", () => {
    expect(() => commentBodySchema.parse("")).toThrow();
    expect(() => commentBodySchema.parse("   ")).toThrow();
  });

  it("rejects a body over 2,000 characters", () => {
    expect(() => commentBodySchema.parse("a".repeat(2001))).toThrow();
    expect(() => commentBodySchema.parse("a".repeat(2000))).not.toThrow();
  });
});

describe("createCommentSchema", () => {
  it("accepts a top-level comment with no parentId", () => {
    expect(() =>
      createCommentSchema.parse({ postId: crypto.randomUUID(), body: "Nice post" }),
    ).not.toThrow();
  });

  it("accepts a reply with a parentId", () => {
    expect(() =>
      createCommentSchema.parse({
        postId: crypto.randomUUID(),
        body: "Agreed",
        parentId: crypto.randomUUID(),
      }),
    ).not.toThrow();
  });

  it("rejects a missing postId or body", () => {
    expect(() => createCommentSchema.parse({ body: "Nice post" })).toThrow();
    expect(() => createCommentSchema.parse({ postId: crypto.randomUUID() })).toThrow();
  });
});

describe("updateCommentSchema", () => {
  it("requires a commentId and body", () => {
    expect(() => updateCommentSchema.parse({ body: "Edited" })).toThrow();
    expect(() =>
      updateCommentSchema.parse({ commentId: crypto.randomUUID(), body: "Edited" }),
    ).not.toThrow();
  });
});
