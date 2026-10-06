import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bytea } from "./custom-types";
import { users } from "./users";

// One MLS member per device (Encryption design, FR-DM-21): linking a device is a membership change.
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label"),
  signaturePublicKey: text("signature_public_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Single-use KeyPackages a device publishes so others can add it to an MLS group (FR-DM-21).
export const keyPackages = pgTable("key_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  keyPackage: bytea("key_package").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
