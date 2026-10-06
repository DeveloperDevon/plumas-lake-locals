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

## Security headers

`src/start.ts` exports `startInstance` (the exact name `@tanstack/react-start`'s plugin looks
for) with a global request middleware setting CSP/X-Frame-Options/Referrer-Policy on every
response. `noindex` is set twice (a `<meta>` tag in `__root.tsx` and `public/robots.txt`) per
NFR-07.
