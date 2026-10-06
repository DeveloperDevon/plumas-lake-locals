import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // Only the hash is ever stored; the raw token lives only in the invite email (FR-INV-02).
    tokenHash: text("token_hash").notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_unique").on(t.tokenHash),
    index("invites_inviter_idx").on(t.inviterId),
    // FR-INV-05: quota counting only needs outstanding (not yet accepted or revoked) invites.
    index("invites_pending_idx")
      .on(t.inviterId)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);
