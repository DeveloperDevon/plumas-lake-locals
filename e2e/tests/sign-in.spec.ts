import { expect, test } from "@playwright/test";

import { seedMember } from "../helpers/seed";
import { signInAsExisting } from "../helpers/ui";

test("an existing member signs in via a magic link", async ({ page }) => {
  const member = await seedMember();

  await signInAsExisting(page, member.email);

  await expect(page.getByRole("heading", { name: `Welcome, ${member.displayName}` })).toBeVisible();
});

test("visiting /home while signed out redirects to /sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in$/);
});
