# @plumas/auth

Better Auth configuration (magic link + passkey) and invite-gated signup.

## Architecture

- **One identity table.** `packages/db`'s `users` table doubles as Better Auth's "user" model
  (`usePlural: true` on the Drizzle adapter resolves Better Auth's singular model names to our
  plural table names; `user.fields.name: "displayName"` maps its canonical "name" field onto
  our existing column instead of adding a redundant one). This means every other table's FK
  into `users.id` resolves to the same identity Better Auth issues sessions for — there's no
  separate, disconnected auth-only user record to keep in sync.
- **Invite-gating happens in application code, not a Better Auth hook.** Earlier drafts of
  this package assumed Better Auth's magic-link plugin would create the user record on first
  sign-in and a `databaseHooks.user.create.before` hook could gate that. Reading the plugin's
  actual implementation showed otherwise: it only ever calls `createUser({ email, name })` —
  there's no path for passing through an invite token or the 18+ attestation. So instead:
  `disableSignUp: true` on the `magicLink` plugin means it never creates accounts, and
  `invite-service.ts`'s `acceptInvite` is the only code path that inserts a `users` row
  (after validating the invite token). The `databaseHooks.user.create.before` hook that
  unconditionally throws is a defense-in-depth backstop, not the primary gate.
- **The caller sends the magic link, not `acceptInvite` itself.** `auth.api.signInMagicLink`
  needs real request headers (`requireHeaders: true` on that endpoint), which a plain service
  function doesn't have. `acceptInvite` returns the created user; `apps/web`'s route calls
  `auth.api.signInMagicLink` afterward with the actual request's headers.
- **`advanced.database.generateId: "uuid"`** makes every id a real UUID (matching every other
  table's `uuid` id in this schema) instead of Better Auth's own non-uuid string generator.
  Non-obvious consequence, caught by `config.test.ts`: in this mode Better Auth omits `id`
  from its insert payloads and expects the column's default to supply it — every Better
  Auth-managed table (`sessions`, `accounts`, `verifications`, `passkeys`) needs
  `.defaultRandom()` on `id`, or inserts fail a not-null constraint.

## Tests

`invite-service.test.ts` and `config.test.ts` are integration tests that run against the real
local Postgres (`DATABASE_URL`), not mocks — `pnpm --filter @plumas/auth test` needs the
docker-compose database up and `.env` sourced. This is deliberate: the riskiest part of this
package is the adapter/schema wiring, which a mocked unit test wouldn't exercise.
