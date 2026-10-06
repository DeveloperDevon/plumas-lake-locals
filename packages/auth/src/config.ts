import { passkey } from "@better-auth/passkey";
import { createDb, schema } from "@plumas/db";
import { sendMagicLinkEmail } from "@plumas/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * A fresh Better Auth instance (and fresh DB connection) per call, never a cached singleton:
 * Cloudflare Workers can reuse the same isolate - and therefore any module-level cache -
 * across many unrelated requests, but forbids touching an I/O object (a socket included)
 * from a request other than the one that opened it. Call this once per request (every
 * apps/web server function and route handler does). Constructing it is cheap - no I/O
 * happens until something actually queries the database.
 */
export function createAuth() {
  return betterAuth({
    database: drizzleAdapter(createDb(mustGetEnv("DATABASE_URL")), {
      provider: "pg",
      schema,
      // Our schema names its tables in the plural (users, sessions, ...); this tells the
      // adapter to resolve Better Auth's canonical singular model names accordingly.
      usePlural: true,
    }),
    secret: mustGetEnv("BETTER_AUTH_SECRET"),
    baseURL: mustGetEnv("PUBLIC_APP_URL"),
    advanced: {
      database: {
        // Postgres generates the id (gen_random_uuid(), per users.ts's default) so it's a
        // uuid like every other table's id in this schema, instead of Better Auth's own
        // non-uuid string id generator.
        generateId: "uuid",
      },
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },
    user: {
      // `users` doubles as Better Auth's "user" model (docs/adr/0003): map its canonical
      // "name" field onto our existing displayName column instead of adding a redundant one.
      fields: {
        name: "displayName",
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh at most once a day
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        // Account creation never goes through this plugin: invite-service.ts's acceptInvite
        // is the only path that creates a user row (see the databaseHooks gate below). This
        // plugin only ever signs an existing member back in.
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail({ to: email, url });
        },
      }),
      passkey({
        rpID: process.env.PUBLIC_APP_DOMAIN ?? "localhost",
        rpName: "Plumas Lake Locals",
      }),
      tanstackStartCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          // Defense-in-depth (FR-INV-03): every legitimate account is created directly by
          // invite-service.ts's acceptInvite after validating an invite token, never through
          // Better Auth's own create-user path (disableSignUp above already blocks the one
          // plugin that could reach it). If this ever fires, something reached user creation
          // through a path we don't expect — reject it outright.
          before: () => {
            throw new Error("Sign-up must go through an invite link.");
          },
        },
      },
    },
  });
}
