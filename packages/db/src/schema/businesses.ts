import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { businessManagerRoleEnum } from "./enums";
import { users } from "./users";

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  logoKey: text("logo_key"),
  logoAltText: text("logo_alt_text"),
  coverKey: text("cover_key"),
  coverAltText: text("cover_alt_text"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  hours: jsonb("hours"),
  // FR-BIZ-01/08: required; confirms the business serves Plumas Lake even if the owner doesn't live there.
  serviceArea: text("service_area").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // FR-BIZ-09: set by a site admin after an upheld "doesn't serve Plumas Lake" report. Hidden
  // from the directory and non-managers while set; managers still see it, with a banner - the
  // visible-state equivalent of "notify the owner" until in-app notifications exist.
  unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
});

export const businessManagers = pgTable(
  "business_managers",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: businessManagerRoleEnum("role").notNull().default("manager"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.userId] })],
);
