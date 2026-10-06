import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { groupMemberRoleEnum, groupMemberStatusEnum, groupVisibilityEnum } from "./enums";
import { users } from "./users";

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  // FR-GRP-10/11: private groups are hidden from the directory, search and the calendar.
  visibility: groupVisibilityEnum("visibility").notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: groupMemberRoleEnum("role").notNull().default("member"),
    status: groupMemberStatusEnum("status").notNull().default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);
