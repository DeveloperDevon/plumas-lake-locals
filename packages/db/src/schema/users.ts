import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { userRoleEnum, userStatusEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    // Better Auth's canonical fields, mapped via `user.fields` in packages/auth's config
    // (emailVerified/image are its own; displayName above maps to its "name" field) — this
    // table doubles as Better Auth's "user" model (see docs/adr/0003) so every other table's
    // FK into users.id resolves to the same identity Better Auth issues sessions for.
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    avatarKey: text("avatar_key"),
    bio: text("bio"),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => users.id),
    role: userRoleEnum("role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("active"),
    // FR-INV-11: stores only the attestation timestamp — no date of birth is ever collected.
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_invited_by_idx").on(t.invitedBy)],
);
