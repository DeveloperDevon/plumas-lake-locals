import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { themeEnum, userRoleEnum, userStatusEnum } from "./enums";

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
    // Populated starting with task #16's media/R2 pipeline - the column exists now so that
    // phase needs no migration of its own, same reasoning as avatarKey in Phase 0.
    coverKey: text("cover_key"),
    bio: text("bio"),
    // FR-PRO-01 (always visible, not covered by fieldVisibility below).
    street: text("street"),
    // FR-PRO-02: optional fields, each covered by fieldVisibility.
    interests: text("interests").array(),
    occupation: text("occupation"),
    pets: text("pets"),
    website: text("website"),
    birthdayMonth: integer("birthday_month"),
    birthdayDay: integer("birthday_day"),
    // FR-PRO-05: one "all" | "connections" value per optional field above, e.g.
    // {"interests":"all","occupation":"connections"} - validated by
    // @plumas/validators' fieldVisibilitySchema, not a DB constraint (same reasoning as
    // moderation.ts's `details` jsonb column).
    fieldVisibility: jsonb("field_visibility"),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => users.id),
    role: userRoleEnum("role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("active"),
    // UI color theme (VS Code-style: a named choice, not just light/dark), declared to Better
    // Auth via user.additionalFields (packages/auth/src/config.ts) so getSession() returns it
    // without a second query.
    theme: themeEnum("theme").notNull().default("system"),
    // FR-INV-11: stores only the attestation timestamp — no date of birth is ever collected.
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("users_invited_by_idx").on(t.invitedBy),
    check(
      "users_birthday_month_check",
      sql`${t.birthdayMonth} is null or ${t.birthdayMonth} between 1 and 12`,
    ),
    check(
      "users_birthday_day_check",
      sql`${t.birthdayDay} is null or ${t.birthdayDay} between 1 and 31`,
    ),
  ],
);
