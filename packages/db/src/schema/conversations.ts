import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { conversationKindEnum, participantStatusEnum } from "./enums";
import { listings } from "./listings";
import { users } from "./users";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: conversationKindEnum("kind").notNull(),
    name: text("name"),
    mlsGroupId: text("mls_group_id"),
    epoch: integer("epoch").notNull().default(0),
    businessId: uuid("business_id").references(() => businesses.id),
    listingId: uuid("listing_id").references(() => listings.id),
    // Populated only when kind = 'direct': least/greatest of the two participant ids, so a
    // partial unique index can enforce "one direct conversation per pair" (FR-DM-01).
    directUserA: uuid("direct_user_a"),
    directUserB: uuid("direct_user_b"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_direct_pair_unique")
      .on(t.directUserA, t.directUserB)
      .where(sql`${t.kind} = 'direct'`),
    index("conversations_last_message_idx").on(t.lastMessageAt),
  ],
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // FR-DM-05: a first message from someone with no prior connection lands as a "request".
    status: participantStatusEnum("status").notNull().default("active"),
    lastReadMessageId: uuid("last_read_message_id"),
    muted: boolean("muted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
