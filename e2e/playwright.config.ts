import path from "node:path";

import { defineConfig } from "@playwright/test";

import { webServerLogFile } from "./helpers/log-path";

export default defineConfig({
  testDir: "./tests",
  // Tests scrape a shared log file for the most recently sent link; running them in parallel
  // would race on whose link is whose, so keep this simple for Phase 0 and run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `mkdir -p "${path.dirname(webServerLogFile)}" && pnpm --filter @plumas/web dev > "${webServerLogFile}" 2>&1`,
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: path.join(path.dirname(webServerLogFile), "..", ".."),
  },
});
