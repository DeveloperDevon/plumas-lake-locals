import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * FR-MOD-01: what can be reported today. The PRD also lists groups, listings and
 * conversations, none of which exist yet - reports.targetType is free text in the DB
 * specifically so later phases can extend this list without a migration, same reasoning
 * already used for notifications.type.
 */
export const reportTargetTypes = ["post", "comment", "profile", "business", "event"] as const;
export type ReportTargetType = (typeof reportTargetTypes)[number];
export const reportTargetTypeSchema = z.enum(reportTargetTypes);

// FR-BIZ-09: "doesnt_serve_plumas_lake" is specific to reporting a business page.
export const reportReasons = [
  "spam",
  "harassment",
  "under_18",
  "inappropriate",
  "doesnt_serve_plumas_lake",
  "other",
] as const;
export type ReportReason = (typeof reportReasons)[number];
export const reportReasonSchema = z.enum(reportReasons);

export const reportDetailsSchema = z.string().trim().max(500);

export const createReportSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: uuidSchema,
  reason: reportReasonSchema,
  details: reportDetailsSchema.optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({ reportId: uuidSchema });
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

export const suspendUserSchema = z.object({ userId: uuidSchema });
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

export const unsuspendUserSchema = z.object({ userId: uuidSchema });
export type UnsuspendUserInput = z.infer<typeof unsuspendUserSchema>;

// post/comment/event are admin-deletable - the same scope as reportTargetTypes minus profile
// and business (there's no "delete a profile" concept - suspend covers that; a business page
// is unpublished, not deleted, via business-service.ts's own admin action).
export const adminDeleteTargetTypes = ["post", "comment", "event"] as const;
export type AdminDeleteTargetType = (typeof adminDeleteTargetTypes)[number];

export const adminDeleteContentSchema = z.object({
  targetType: z.enum(adminDeleteTargetTypes),
  targetId: uuidSchema,
});
export type AdminDeleteContentInput = z.infer<typeof adminDeleteContentSchema>;
