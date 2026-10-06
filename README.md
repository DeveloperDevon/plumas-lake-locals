# Plumas Lake Locals

A private, invite-only social network for the Plumas Lake community: profiles, a community feed,
family relationships, interest groups, local business pages, end-to-end encrypted messages, a
marketplace, and a shared calendar.

This repository currently implements **Phase 0: Foundations** of the release roadmap — the
monorepo scaffold, the full database schema, invite-gated authentication, and CI. Later phases
(feed, groups, business pages, calendar, marketplace, end-to-end encrypted messaging) build on
top of this without schema rework.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite) deployed to Cloudflare Workers via Nitro
- PostgreSQL ([Neon](https://neon.tech)) with [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://www.better-auth.com) (magic link + passkey, invite-gated signup)
- [Resend](https://resend.com) + [React Email](https://react.email)
- pnpm workspaces + [Turborepo](https://turbo.build)
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com)

## Requirements

- Node.js v24.21.0 (see `.nvmrc`)
- pnpm 12.9.1 (pinned via `packageManager`; use `corepack enable && corepack prepare pnpm@12.9.1 --activate`)
- Docker (for local Postgres)

## Getting started

```bash
nvm use                                    # -> Node v24.21.0
corepack enable && corepack prepare pnpm@12.9.1 --activate
cp .env.example .env                       # fill in values as needed
cp apps/web/.dev.vars.example apps/web/.dev.vars  # same values, see apps/web/README.md for why
docker compose up -d                       # Postgres on :5432
pnpm install
pnpm db:migrate
pnpm db:seed                               # creates an admin user, prints an invite URL
pnpm dev                                   # apps/web on http://localhost:3000
```

With `RESEND_API_KEY` left unset, invite and magic-link emails are logged to the console instead
of sent, so the full invite -> signup -> sign-in loop works locally without an email provider.

## Monorepo layout

```text
plumas-lake-locals/
├─ apps/
│  └─ web/                 # TanStack Start app (routes, server functions)
├─ packages/
│  ├─ db/                  # Drizzle schema, migrations, seed
│  ├─ auth/                # Better Auth config, invite-gated signup
│  ├─ validators/          # zod schemas shared by client and server
│  ├─ ui/                  # shadcn/ui components, Tailwind preset
│  ├─ email/               # React Email templates
│  ├─ crypto/              # MLS client (Web Worker), device keys, encrypted backup — future phase
│  └─ config/              # tsconfig, eslint, prettier presets
├─ e2e/                    # Playwright tests
├─ turbo.json
└─ pnpm-workspace.yaml
```

Architecture decisions are recorded in `docs/adr/`.
