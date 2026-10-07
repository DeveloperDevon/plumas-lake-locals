import { describe, expect, it } from "vitest";

import {
  adminDeleteContentSchema,
  createReportSchema,
  reportReasonSchema,
  reportTargetTypeSchema,
  resolveReportSchema,
  suspendUserSchema,
} from "./moderation";

describe("reportTargetTypeSchema", () => {
  it("accepts post, comment and profile", () => {
    expect(reportTargetTypeSchema.parse("post")).toBe("post");
    expect(reportTargetTypeSchema.parse("comment")).toBe("comment");
    expect(reportTargetTypeSchema.parse("profile")).toBe("profile");
  });

  it("rejects an unsupported target type", () => {
    expect(() => reportTargetTypeSchema.parse("group")).toThrow();
  });
});

describe("reportReasonSchema", () => {
  it("accepts every canonical reason", () => {
    for (const reason of ["spam", "harassment", "under_18", "inappropriate", "other"]) {
      expect(reportReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it("rejects an unknown reason", () => {
    expect(() => reportReasonSchema.parse("not_a_real_reason")).toThrow();
  });
});

describe("createReportSchema", () => {
  it("accepts a report with no details", () => {
    expect(() =>
      createReportSchema.parse({
        targetType: "post",
        targetId: crypto.randomUUID(),
        reason: "spam",
      }),
    ).not.toThrow();
  });

  it("rejects a missing targetId or reason", () => {
    expect(() => createReportSchema.parse({ targetType: "post", reason: "spam" })).toThrow();
    expect(() =>
      createReportSchema.parse({ targetType: "post", targetId: crypto.randomUUID() }),
    ).toThrow();
  });
});

describe("resolveReportSchema and suspendUserSchema", () => {
  it("require a uuid id", () => {
    expect(() => resolveReportSchema.parse({ reportId: crypto.randomUUID() })).not.toThrow();
    expect(() => resolveReportSchema.parse({ reportId: "not-a-uuid" })).toThrow();
    expect(() => suspendUserSchema.parse({ userId: crypto.randomUUID() })).not.toThrow();
  });
});

describe("adminDeleteContentSchema", () => {
  it("accepts post and comment targets", () => {
    expect(() =>
      adminDeleteContentSchema.parse({ targetType: "post", targetId: crypto.randomUUID() }),
    ).not.toThrow();
    expect(() =>
      adminDeleteContentSchema.parse({ targetType: "comment", targetId: crypto.randomUUID() }),
    ).not.toThrow();
  });

  it("rejects a profile target - suspend covers that case instead", () => {
    expect(() =>
      adminDeleteContentSchema.parse({ targetType: "profile", targetId: crypto.randomUUID() }),
    ).toThrow();
  });
});
