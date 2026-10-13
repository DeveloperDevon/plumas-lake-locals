import { defineConfig } from "vitest/config";

// Deliberately not vite.config.ts's own plugins (Cloudflare/TanStack Start) - those assume a
// real dev-server context and fail to even construct under vitest. Unit tests here are plain
// Node-side logic (e.g. lib/format-date.ts), not anything that needs the app's SSR pipeline.
export default defineConfig({
  test: {
    environment: "node",
  },
});
