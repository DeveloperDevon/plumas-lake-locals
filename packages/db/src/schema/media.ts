import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { listings } from "./listings";
import { posts } from "./posts";
import { users } from "./users";

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  albumId: uuid("album_id"),
  // FR-MKT-01: a listing's photos - cascades, since listings (task #28) are hard-deleted like
  // events, not soft-deleted like posts; without cascade, deleting a listing with photos would
  // fail on this FK.
  listingId: uuid("listing_id").references(() => listings.id, { onDelete: "cascade" }),
  // FR-FEED-01: a post's attached images (task #17) - nullable, same pattern as listingId.
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  // FR-BIZ-03: a business page's photo gallery - nullable, same pattern as postId/listingId.
  businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
