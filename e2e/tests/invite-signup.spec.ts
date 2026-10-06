import { expect, test } from "@playwright/test";

import { logCheckpoint, waitForInviteLink } from "../helpers/mail";
import { seedMember, uniqueEmail } from "../helpers/seed";
import { signInAsExisting } from "../helpers/ui";
import { waitForHydration } from "../helpers/wait-for-hydration";

test("a neighbor accepts an invite, creates an account, and signs in", async ({
  page,
  browser,
}) => {
  const inviter = await seedMember();
  await signInAsExisting(page, inviter.email);

  const newNeighborEmail = uniqueEmail("new-neighbor");
  const checkpoint = logCheckpoint();
  await page.getByLabel("Email").fill(newNeighborEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  const inviteUrl = await waitForInviteLink(checkpoint);

  // The new neighbor is a different person, in their own browser context.
  const neighborContext = await browser.newContext();
  const neighborPage = await neighborContext.newPage();
  await neighborPage.goto(inviteUrl);
  await waitForHydration(neighborPage);
  await expect(neighborPage.getByText(newNeighborEmail)).toBeVisible();
  await expect(
    neighborPage.getByRole("heading", { name: "Join Plumas Lake Locals" }),
  ).toBeVisible();

  await neighborPage.getByLabel("Display name").fill("Jordan L.");
  await neighborPage.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await neighborPage.getByLabel("Confirm password").fill("correct-horse-battery");
  await neighborPage.getByLabel("I am 18 or older").check();

  await neighborPage.getByRole("button", { name: "Create account" }).click();

  await expect(neighborPage).toHaveURL(/\/home$/);
  await expect(neighborPage.getByRole("heading", { name: "Welcome, Jordan L." })).toBeVisible();
  await expect(neighborPage.getByRole("heading", { name: "Invite a neighbor" })).toBeVisible();

  await neighborContext.close();
});

test("a second attempt to use the same invite token fails", async ({ page, browser }) => {
  const inviter = await seedMember();
  await signInAsExisting(page, inviter.email);

  const email = uniqueEmail("one-time-use");
  const checkpoint = logCheckpoint();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invite" }).click();
  const inviteUrl = await waitForInviteLink(checkpoint);

  const neighborContext = await browser.newContext();
  const neighborPage = await neighborContext.newPage();
  await neighborPage.goto(inviteUrl);
  await waitForHydration(neighborPage);
  await neighborPage.getByLabel("Display name").fill("First Try");
  await neighborPage.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await neighborPage.getByLabel("Confirm password").fill("correct-horse-battery");
  await neighborPage.getByLabel("I am 18 or older").check();
  await neighborPage.getByRole("button", { name: "Create account" }).click();
  await expect(neighborPage).toHaveURL(/\/home$/);

  // Reload the same accept URL - the invite is already accepted, so it must now be rejected.
  await neighborPage.goto(inviteUrl);
  await expect(
    neighborPage.getByRole("heading", { name: "This invite is no longer valid" }),
  ).toBeVisible();

  await neighborContext.close();
});
