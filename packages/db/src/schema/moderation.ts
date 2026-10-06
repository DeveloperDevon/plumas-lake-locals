import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// FR-MOD-01: reportable targets include posts, comments, profiles, groups, business pages,
// events, listings and conversations — kept as text rather than an enum for the same reason
// as notifications.type, since later phases add more reportable entity kinds.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    // Known reasons include "under_18" (FR-INV-12) and "doesnt_serve_plumas_lake" (FR-BIZ-09),
    // among open-ended ones; a DM report additionally snapshots the reported messages (FR-DM-08).
    reason: text("reason").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    details: jsonb("details"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_target_idx").on(t.targetType, t.targetId)],
);

// FR-MOD-05: every admin action, including every private-group access (FR-GRP-13).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    action: text("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
  ],
);
