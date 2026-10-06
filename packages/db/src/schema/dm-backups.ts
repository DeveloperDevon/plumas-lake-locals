import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bytea } from "./custom-types";
import { users } from "./users";

// FR-DM-22: encrypted history backup under a key only the member holds; the server never
// sees the unwrapped key.
export const dmBackups = pgTable("dm_backups", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  r2Key: text("r2_key").notNull(),
  wrappedBackupKey: bytea("wrapped_backup_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
