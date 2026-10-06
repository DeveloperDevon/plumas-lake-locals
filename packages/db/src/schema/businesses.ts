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
  coverKey: text("cover_key"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  hours: jsonb("hours"),
  // FR-BIZ-01/08: required; confirms the business serves Plumas Lake even if the owner doesn't live there.
  serviceArea: text("service_area").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
