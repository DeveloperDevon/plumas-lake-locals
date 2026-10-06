# 0001 — Monorepo tooling

**Status:** Accepted

## Context

Phase 0 needed a monorepo layout and toolchain for one app (`apps/web`) and several shared
packages (`db`, `auth`, `validators`, `ui`, `email`, `crypto`, `config`), with CI, consistent
TypeScript/lint/format config, and a database that multiple packages need during local dev.

## Decision

- **pnpm workspaces + Turborepo.** Lightweight, caches build/test/lint across packages. No Nx.
- **Node v24.21.0 (latest Active LTS) + pnpm 12.9.1 (latest),** pinned via `.nvmrc`/
  `.node-version` and `packageManager`, activated via Corepack.
- **TypeScript 6.0.3, not the newest 7.0 line.** `typescript-eslint` (our lint tooling)
  declares peer support for `typescript >=4.8.4 <6.1.0` — 7.0 is too fresh for it. 6.0.3 is the
  latest version inside that range, and what `apps/web`'s own scaffold tooling resolved to
  independently, so the whole workspace stays on one consistent, lintable version.
- **Shared presets in `packages/config`** (tsconfig base/app/node, flat ESLint configs,
  Prettier) rather than repeating config per package.
- **No build step for internal packages.** Every package exports its TS/TSX source directly
  (`"exports": { ".": "./src/index.ts" }`); consumers (`apps/web`'s Vite build, `tsx` for
  scripts) compile it themselves. Simpler for a Phase 0 monorepo where nothing publishes to a
  registry.

## Consequences

- Turborepo 2.x defaults to **strict env mode**: undeclared env vars are filtered out of task
  runtimes entirely, even with a `.env` file present. `turbo.json`'s `globalEnv` must list
  every var any task actually reads, or a task that reads `process.env.X` directly (not via a
  framework's dotenv loading) silently gets `undefined` for `X` — this broke
  `pnpm turbo run test` for `@plumas/auth` even though `pnpm --filter @plumas/auth test` (no
  turbo involved) worked fine with the same `.env` sourced.
- Consuming packages as raw source means a package's `tsconfig.json` (e.g. `jsx: "react-jsx"`
  for anything importing a `.tsx` file transitively) has to satisfy every consumer's
  type-checking needs, not just its own — see `packages/auth`'s and `e2e`'s tsconfig
  overrides.
