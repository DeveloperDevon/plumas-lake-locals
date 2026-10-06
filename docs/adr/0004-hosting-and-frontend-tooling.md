# 0004 — Hosting and frontend tooling

**Status:** Accepted

## Context

The PRD calls for TanStack Start deployed to Cloudflare Workers, Tailwind v4 + shadcn/ui, with
free-tier hosting as a hard constraint. TanStack Start's docs call it release-candidate
software on the 1.168.x branch; this phase needed to confirm the stack actually works together
before building on it.

## Decision

- **Scaffolded via `@tanstack/cli` against the real npm registry**, not from memory — an
  earlier, deprecated CLI (`create-tsrouter-app`) silently defaulted to router-only mode with
  no Start/Cloudflare wiring at all. Fast-moving frameworks like this are exactly where
  training-data assumptions go stale fastest; the working versions (`@tanstack/react-start`
  1.168.60, `@tanstack/react-router` 1.170.41, Vite 8, `@cloudflare/vite-plugin`) were
  confirmed by actually building and booting the scaffold, repeatedly, while adding each piece.
- **`@cloudflare/vite-plugin` + `tanstackStart()` + `@tailwindcss/vite`** in `vite.config.ts`;
  `wrangler.jsonc`'s `main` points at the package-internal
  `@tanstack/react-start/server-entry`, not a local file.
- **Security headers via a global request middleware** (`src/start.ts`, exporting
  `startInstance` — the exact name the plugin looks for), not per-route: CSP, X-Frame-Options,
  Referrer-Policy on every response. `noindex` is set twice (a `<meta>` tag and
  `public/robots.txt`) per NFR-07.
- **`apps/web` runs its SSR code inside `workerd`,** Cloudflare's local Workers runtime
  simulator — not plain Node. This has two concrete, discovered consequences, below.

## Consequences

- **`workerd` does not inherit the shell's environment at all.** It reads a `.dev.vars` file
  (Wrangler's convention, gitignored, mirrors `.env.example`'s keys) — not `.env`, which is
  what `packages/db`/`packages/auth`/etc. read when run directly under Node. `apps/web` needs
  its own copy of the same values in `.dev.vars`; CI generates one from job env vars before
  starting the Playwright `webServer` (see `.github/workflows/test.yml`).
- **Tailwind v4's content detection does not cross pnpm workspace package boundaries.**
  `packages/ui`'s own stylesheet needs an explicit `@source ".."` directive, or every utility
  class used only inside its components is silently missing from `apps/web`'s generated CSS —
  invisible to any text/HTML check (the class names still render fine), only caught by a
  Playwright test actually measuring a checkbox's layout. See `e2e/README.md`.
- Pinned `@tanstack/react-start`/`@tanstack/react-router` to exact versions (no `^`/`~`), per
  the PRD's own instruction to upgrade this dependency deliberately while it's pre-1.0.
