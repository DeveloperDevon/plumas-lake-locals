import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { userRoleEnum, userStatusEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    avatarKey: text("avatar_key"),
    bio: text("bio"),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => users.id),
    role: userRoleEnum("role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("active"),
    // FR-INV-11: stores only the attestation timestamp — no date of birth is ever collected.
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_invited_by_idx").on(t.invitedBy)],
);
