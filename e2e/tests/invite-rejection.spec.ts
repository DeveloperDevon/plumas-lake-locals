import { expect, test } from "@playwright/test";
import { schema } from "@plumas/db";
import { eq } from "drizzle-orm";

import { testDb } from "../helpers/seed";
import { waitForHydration } from "../helpers/wait-for-hydration";

test("a missing token shows the rejection, not a crash", async ({ page }) => {
  await page.goto("/invite/accept");
  await expect(page.getByRole("heading", { name: "This invite is no longer valid" })).toBeVisible();
});

test("an unknown token shows the rejection", async ({ page }) => {
  await page.goto(`/invite/accept?token=${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This invite is no longer valid" })).toBeVisible();
});

test("a malformed (too-short) token shows the rejection instead of a server error", async ({
  page,
}) => {
  const response = await page.goto("/invite/accept?token=too-short");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "This invite is no longer valid" })).toBeVisible();
});

test("signing in with an email no one invited never creates an account", async ({ page }) => {
  const email = `uninvited-${crypto.randomUUID()}@example.test`;

  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  // The UI doesn't reveal whether the email had an account (FR-DM-05-style non-disclosure for
  // sign-in) - it always shows the same message.
  await expect(page.getByText(/sign-in link is on its way/i)).toBeVisible();

  const db = testDb();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  expect(existing).toBeUndefined();
});
