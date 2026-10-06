import { index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { conversations } from "./conversations";
import { bytea } from "./custom-types";
import { devices } from "./devices";

export const messages = pgTable(
  "messages",
  {
    // App-generated UUIDv7 for natural chronological ordering — never .defaultRandom() (v4).
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderDeviceId: uuid("sender_device_id")
      .notNull()
      .references(() => devices.id),
    epoch: integer("epoch").notNull(),
    // FR-DM-09: ciphertext only. No plaintext column, ever — enforced by code review and
    // docs/adr/0005, not a database constraint, since Postgres can't type-check "never decryptable".
    ciphertext: bytea("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    unsentAt: timestamp("unsent_at", { withTimezone: true }),
  },
  (t) => [
    // Keyset pagination within a conversation.
    index("messages_conversation_idx").on(t.conversationId, t.id),
  ],
);
