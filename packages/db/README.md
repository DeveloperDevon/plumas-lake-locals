# @plumas/db

Drizzle ORM schema, migrations and seed scripts. The schema covers the **entire** v1 data
model (all 24 tables across every release phase), even though only `users`, `invites` and
`relationships` have application code exercising them in Phase 0 — this avoids migration
churn as later phases build on top.

## Migration workflow

1. Edit schema files under `src/schema/`.
2. `pnpm generate` (or `pnpm db:generate` from the repo root) diffs the schema and writes a new
   file under `migrations/`.
3. For constraints Drizzle can express directly (expression/partial indexes, `CHECK`), it
   generates correct SQL automatically — no manual patching needed for this schema.
4. For anything it can't express (notably Postgres row-level security policies), add a custom
   migration: `pnpm exec drizzle-kit generate --custom --name=<name>`, then fill in the empty
   file it creates. The canonical RLS policy source lives in `src/rls/*.sql` for reference; it
   is applied via `migrations/0001_rls_policies.sql`.
5. Commit `migrations/*.sql` — never edit or regenerate an already-applied migration.
6. `pnpm migrate` (or `pnpm db:migrate` from the repo root) applies pending migrations against
   `DATABASE_URL`.

## Seeding

`pnpm seed` (or `pnpm db:seed`) creates/reuses an admin user from `ADMIN_SEED_EMAIL` and, for
each address in the comma-separated `ADMIN_SEED_INVITE_EMAILS`, prints an invite URL containing
the raw token — the only place the raw token is ever visible; the database stores only its hash.

## Row-level security caveat

The RLS policies in `migrations/0001_rls_policies.sql` are defense-in-depth (NFR-06), not the
primary access control (that's enforced in application code). Note that Postgres RLS does not
apply to a table's owning role by default — the local/CI `plumas` role both owns these tables
and is what the app connects as, so RLS is scaffolded and verified to exist, but isn't yet
actually restricting queries end-to-end. Enforcing it for real requires the app to connect via
a separate, non-owning role; that's left for a later phase (tracked in docs/adr/0002).
