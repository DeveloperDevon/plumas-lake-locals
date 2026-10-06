# 0003 — Auth strategy and invite gating

**Status:** Accepted

## Context

The PRD requires invite-only signup (FR-INV-03), magic-link and passkey sign-in (FR-INV-07),
and no residency/ZIP check — a member's vouch is the only eligibility check. Better Auth was
the chosen library.

## Decision

- **Better Auth, with `packages/db`'s `users` table doubling as its "user" model.**
  `usePlural: true` on the Drizzle adapter resolves Better Auth's singular model names
  (`user`, `session`, ...) to our plural table names; `user.fields.name: "displayName"` maps
  its canonical "name" field onto our existing column. This means every other table's FK into
  `users.id` resolves to the same identity Better Auth issues sessions for — there's no
  separate, disconnected auth-only user record to keep in sync. `sessions`, `accounts`,
  `verifications`, `passkeys` are new tables Better Auth needs; `accounts` is unused in Phase 0
  (no OAuth providers wired yet) but exists so enabling Google OAuth later needs no migration.
- **Invite-gating happens in application code, not a Better Auth hook.** Reading the
  magic-link plugin's actual implementation showed it only ever calls
  `createUser({ email, name })` — there's no path for passing through an invite token or the
  18+ attestation. So: `disableSignUp: true` on the `magicLink` plugin means it never creates
  accounts, and `invite-service.ts`'s `acceptInvite` is the only code path that inserts a
  `users` row, after validating the invite token itself. The `databaseHooks.user.create.before`
  hook that unconditionally throws is a defense-in-depth backstop, not the primary gate.
- **`createAuth()` is a factory, not a cached singleton.** Same reasoning as `createDb()` in
  ADR 0002 — Workers forbids reusing an I/O object (the DB connection Better Auth holds)
  across requests. Every `apps/web` route/server function calls it fresh.
- **No custom `/auth/verify` page.** Better Auth's own `/api/auth/magic-link/verify` endpoint
  (reached through `apps/web`'s `/api/auth/$` catch-all) verifies the token and redirects
  straight to `callbackURL` itself — confirmed by reading its implementation, not assumed from
  older docs. Building a separate page for this would be dead code in front of behavior Better
  Auth already provides.

## Consequences

- The session's `user.name` field (not `user.displayName`) is what `apps/web` reads — Better
  Auth's public API always exposes its own canonical field names regardless of the `fields`
  mapping, which only tells the adapter which underlying column to read/write. Verified
  empirically (a quick throwaway integration test printed the actual shape) rather than
  assumed, since getting this wrong would have been a silent bug.
- Passkey registration itself needs no separate invite-gating — it can only happen for an
  already-authenticated session, i.e. after a member has signed up via magic link once.
- Google OAuth (stretch, `GOOGLE_OAUTH_ENABLED`) will route through the same
  `databaseHooks.user.create` gate uniformly once enabled, so no extra plumbing is needed when
  that's turned on.
