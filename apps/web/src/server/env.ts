const REQUIRED_ENV_VARS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "PUBLIC_APP_URL"] as const;

/**
 * Called once per request (from router.tsx's getRouter()) so missing config fails fast and
 * clearly at boot, rather than deep inside an unrelated request later.
 */
export function assertRequiredEnv(): void {
  // router.tsx is isomorphic (imported by both the client and server bundles); `process` is
  // only meaningful on the server, so skip entirely when this runs in the browser.
  if (typeof window !== "undefined") return;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s): ${missing.join(", ")}`);
  }
}
