import type { Page } from "@playwright/test";

/**
 * Without this, Playwright's auto-waiting lets `.click()` fire before TanStack Start's client
 * JS has attached event handlers, so the form's native (uncontrolled) submit behavior runs
 * instead - a real GET to the current URL - rather than the intended client-side server
 * function call.
 *
 * `page.waitForLoadState("networkidle")` looked like the right tool but isn't: Vite's dev
 * server keeps an HMR WebSocket open indefinitely, so "no network activity for 500ms" never
 * arrives and the wait hung for minutes in practice. The app's own `$_TSR.hydrated` flag is
 * no good either - it deletes itself right after hydration completes, so polling for it races
 * the same cleanup. A bounded wait is the pragmatic fix: hydration for this app is fast
 * (confirmed empirically - well under a second), so a short fixed delay comfortably covers it
 * without depending on a signal that's either unreliable or self-destructing.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForTimeout(500);
}
