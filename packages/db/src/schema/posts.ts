import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { postCategoryEnum, postContextTypeEnum } from "./enums";
import { users } from "./users";

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    // One polymorphic post component serves the main feed, a group board and a business
    // board; contextId is null for the main feed and references the group/business otherwise.
    contextType: postContextTypeEnum("context_type").notNull(),
    contextId: uuid("context_id"),
    body: text("body").notNull(),
    // FR-FEED-06: optional.
    category: postCategoryEnum("category"),
    // FR-FEED-07: null = not pinned; set = pinned, ordered by this value (admin-only, capped
    // at 3 - enforced in packages/auth's post-service.ts, not a DB constraint).
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // FR-FEED-02: reverse-chronological, cursor-paginated within a context.
    index("posts_context_idx").on(t.contextType, t.contextId, t.createdAt),
  ],
);
