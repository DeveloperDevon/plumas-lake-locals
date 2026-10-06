import { sql } from "drizzle-orm";
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { listingKindEnum, listingPriceUnitEnum, listingStatusEnum, listingTypeEnum } from "./enums";
import { users } from "./users";

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    // FR-MKT-11: business pages can list items/services, shown with the business badge.
    businessId: uuid("business_id").references(() => businesses.id),
    kind: listingKindEnum("kind").notNull(),
    type: listingTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    condition: text("condition"),
    priceCents: integer("price_cents"),
    priceUnit: listingPriceUnitEnum("price_unit"),
    status: listingStatusEnum("status").notNull().default("available"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // FR-MKT-03/04: default browse/filter query is newest-first within an available type+category.
    index("listings_available_idx")
      .on(t.type, t.category, t.createdAt)
      .where(sql`${t.status} = 'available'`),
  ],
);

export const listingInterests = pgTable(
  "listing_interests",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.userId] }),
    // FR-MKT-09: first-come, first-served queue order for Free listings.
    index("listing_interests_queue_idx").on(t.listingId, t.createdAt),
  ],
);
