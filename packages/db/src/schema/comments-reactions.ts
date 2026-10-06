import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { commentTargetTypeEnum, reactionTypeEnum } from "./enums";
import { users } from "./users";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: commentTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // One level of replies (FR-FEED-03): a top-level comment has parentId = null.
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("comments_target_idx").on(t.targetType, t.targetId, t.createdAt)],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: commentTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: reactionTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reactions_target_idx").on(t.targetType, t.targetId),
    // One reaction per member per target; changing reaction type is an update, not a new row.
    uniqueIndex("reactions_unique_per_user").on(t.targetType, t.targetId, t.userId),
  ],
);
