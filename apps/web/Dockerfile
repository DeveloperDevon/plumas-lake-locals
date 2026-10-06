# Dev-only image: installs dependencies at build time, then relies on docker-compose bind-mounting
# the repo source over this at runtime for live reload. Rebuild when dependencies change
# (docker compose build web); source edits alone don't need a rebuild.
FROM node:24.21.0-slim

RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

WORKDIR /app

# Copy just the manifests first so `pnpm install` is cached unless a dependency actually changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/validators/package.json packages/validators/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/crypto/package.json packages/crypto/package.json

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "cd apps/web && pnpm exec vite dev --port 3000 --host 0.0.0.0"]
