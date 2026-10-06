# @plumas/web

The TanStack Start app: routes, server functions, and the Better Auth + invite-gated signup
flow wired to a real browser-facing UI.

## Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in values (see below)
pnpm dev                          # http://localhost:3000
```

### `.dev.vars`, not `.env`

This app runs its SSR code inside Cloudflare's local Workers runtime (`workerd`, via
`@cloudflare/vite-plugin`), not plain Node. Workers don't inherit the shell's environment —
`wrangler`'s convention is a **`.dev.vars`** file (gitignored, mirrors `.env.example`'s keys),
loaded into `process.env` locally via the `nodejs_compat` compatibility flag. The repo-root
`.env` is what `packages/db`/`packages/auth`/etc. read when run directly under Node (migrations,
seed script, tests) — `apps/web` needs its own copy of the same values in `.dev.vars`. In
production, the equivalent is `wrangler secret put <NAME>` per secret, plus non-secret values
under `wrangler.jsonc`'s `vars`.

## Routes (Phase 0)

| Route                                      | Purpose                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `/`                                        | Public landing page                                                                |
| `/sign-in`                                 | Magic-link sign-in for existing members                                            |
| `/invite/accept?token=...`                 | Validates the invite, collects display name + 18+ attestation, creates the account |
| `/legal/terms`, `/legal/privacy`           | Static pages                                                                       |
| `/home` (under the `_app` pathless layout) | Auth-gated; welcome + an invites panel (send/list/revoke/resend)                   |
| `/api/auth/$`                              | Catch-all mounting Better Auth's own handler                                       |

There is deliberately no custom `/auth/verify` page: Better Auth's own
`/api/auth/magic-link/verify` endpoint (reached through the `/api/auth/$` catch-all) verifies
the token and redirects straight to `callbackURL` itself — building a separate page for this
would just be dead code in front of behavior Better Auth already provides.

## Server functions (`src/server/functions/`)

Thin wrappers around `@plumas/auth`'s `invite-service` and Better Auth's `auth.api`, each a
`createServerFn`. `acceptInvite` (in `@plumas/auth`) never signs a member in itself — it only
creates the row — because `auth.api.signInMagicLink` needs the real request headers, which the
route layer has and a plain service function doesn't; see `src/server/functions/invite.ts`.

**Always get a fresh DB connection and a fresh Better Auth instance per call** — `getDb()`
(`src/server/db.ts`) and `createAuth()` (`@plumas/auth`), never a cached singleton. Cloudflare
Workers can reuse the same isolate, and therefore any module-level cache, across many
unrelated requests, but forbids touching an I/O object (a socket included) from a request
other than the one that opened it. A cached connection works on the first request after a
cold start and then hangs — "Cannot perform I/O on behalf of a different request" — on the
next one, caught here by actually making two sequential real HTTP requests against the
running dev server, not just unit tests (which run under plain Node and never hit this).

**The DB driver is `postgres` (postgres.js), not `pg`.** `pg`'s wire-protocol handling hung
specifically on `INSERT/UPDATE ... RETURNING` under Cloudflare's local Workers runtime
(`workerd`) — plain `SELECT`s and `RETURNING`-less writes worked fine, anything with
`RETURNING` hung until the Workers runtime killed the request. Found with a one-off
diagnostic route while building this app; `postgres-js` doesn't have the problem and works
identically under plain Node for `packages/db`'s migrate/seed scripts and every package's
tests. See `packages/db/src/client.ts`.

## Security headers

`src/start.ts` exports `startInstance` (the exact name `@tanstack/react-start`'s plugin looks
for) with a global request middleware setting CSP/X-Frame-Options/Referrer-Policy on every
response. `noindex` is set twice (a `<meta>` tag in `__root.tsx` and `public/robots.txt`) per
NFR-07.
