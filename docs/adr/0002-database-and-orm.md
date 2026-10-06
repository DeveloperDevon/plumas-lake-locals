# 0002 — Database and ORM

**Status:** Accepted

## Context

The PRD calls for PostgreSQL (Neon in production) with Drizzle ORM, covering all 24 tables
across every release phase so later phases don't need schema-breaking migrations.

## Decision

- **PostgreSQL + Drizzle ORM**, schema written by hand (one file per domain area under
  `packages/db/src/schema/`), not generated from an existing database.
- **`postgres` (postgres.js), not `pg` (node-postgres), as the driver.** `pg`'s wire-protocol
  handling hangs specifically on `INSERT`/`UPDATE ... RETURNING` under Cloudflare's local
  Workers runtime (`workerd`) — plain `SELECT`s and `RETURNING`-less writes worked fine,
  anything with `RETURNING` hung until the Workers runtime killed the request. Found with a
  one-off diagnostic route while building `apps/web`. `postgres-js` doesn't have the problem,
  and works identically under plain Node for migrate/seed scripts and every package's tests.
- **A fresh connection per call (`createDb()`), not a cached singleton, for any
  request-handling code.** Cloudflare Workers can reuse the same isolate — and therefore any
  module-level cache — across many unrelated requests, but forbids touching an I/O object (a
  socket included) from a request other than the one that opened it. A cached connection works
  on the first request after a cold start and then hangs — "Cannot perform I/O on behalf of a
  different request" — on the next one. `db()` (a cached singleton) still exists, but only for
  one-shot Node processes (`migrate.ts`, `seed.ts`) and tests that exit or finish shortly after
  a single unit of work; `apps/web` never imports it (see `apps/web/src/server/db.ts`'s
  `getDb()` and `@plumas/auth`'s `createAuth()`).
- **Row-level security on `users`/`invites`** as defense-in-depth (NFR-06) alongside explicit
  application-level checks, applied as a custom Drizzle migration.
- **The canonical `relationship_type` list lives in `@plumas/validators`,** imported into the
  Postgres enum — the PRD's own example SQL enum was missing `child`/`grandchild`/
  `niece_nephew`, which its prose (FR-REL-01) listed; making the zod schema the single source
  of truth means the two can't drift apart again the way the PRD itself did.

## Consequences

- Postgres RLS doesn't apply to a table's owning role by default, and the local/CI `plumas`
  role both owns these tables and is what the app connects as — so RLS is scaffolded and
  verified to exist, but isn't yet actually restricting queries end-to-end. Enforcing it for
  real needs the app to connect via a separate, non-owning role; left for a later phase.
- `advanced.database.generateId: "uuid"` (Better Auth, see ADR 0003) means Better Auth omits
  `id` from its own insert payloads and expects the column's default to supply it — every
  Better Auth-managed table (`sessions`, `accounts`, `verifications`, `passkeys`) needs
  `.defaultRandom()` on `id`, caught by `packages/auth`'s `config.test.ts`.
- No Hyperdrive/Neon-specific pooling yet — `createDb()` opens a plain `postgres-js`
  connection per call with `max: 1` and a short `idle_timeout`. Fine for Phase 0's local-dev
  scale; production on Cloudflare will likely want Hyperdrive, which changes the pooling story
  again (left for that phase).
