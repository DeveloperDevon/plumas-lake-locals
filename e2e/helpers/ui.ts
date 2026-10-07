import { expect, type Page } from "@playwright/test";

import { logCheckpoint, waitForMagicLink } from "./mail";
import { waitForHydration } from "./wait-for-hydration";

/** Drives the real /sign-in form end to end, landing the page on /feed. */
export async function signInAsExisting(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(email);

  const checkpoint = logCheckpoint();
  await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
  await expect(page.getByText(/sign-in link is on its way/i)).toBeVisible();

  const magicLink = await waitForMagicLink(checkpoint);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/feed$/);
}
