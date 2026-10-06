import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { relationshipStatusEnum, relationshipTypeEnum } from "./enums";
import { users } from "./users";

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUser: uuid("to_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // from_user is <type> of to_user; the inverse label is derived (FR-REL-03), never stored.
    type: relationshipTypeEnum("type").notNull(),
    status: relationshipStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("relationships_no_self_check", sql`${t.fromUser} <> ${t.toUser}`),
    // One relationship per unordered pair of members, regardless of direction.
    uniqueIndex("relationships_pair_unique").on(
      sql`least(${t.fromUser}, ${t.toUser})`,
      sql`greatest(${t.fromUser}, ${t.toUser})`,
    ),
  ],
);
