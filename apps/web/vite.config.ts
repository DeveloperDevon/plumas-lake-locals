import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    // Lets e2e/load's k6 script (run via `docker run ... grafana/k6`, not installed locally)
    // reach this dev server as host.docker.internal on Docker Desktop (macOS/Windows) - Vite's
    // Host-header check otherwise 403s requests whose Host doesn't match localhost. Dev-only:
    // `server` has no effect on a production build.
    allowedHosts: ["host.docker.internal"],
  },
});
