import AxeBuilder from "@axe-core/playwright";
import { type Page, test } from "@playwright/test";

import { logCheckpoint, waitForInviteLink } from "../helpers/mail";
import {
  seedBusiness,
  seedEvent,
  seedGroup,
  seedListing,
  seedMember,
  uniqueEmail,
} from "../helpers/seed";
import { signInAsExisting } from "../helpers/ui";
import { waitForHydration } from "../helpers/wait-for-hydration";

/**
 * NFR-09: WCAG 2.2 AA, verified via "axe-core in CI + manual VoiceOver pass" - this is the
 * axe-core half (the VoiceOver pass stays a manual pre-launch step, no screen reader available
 * in this environment). Every route gets the same check: no axe violation at "serious" or
 * "critical" impact - the two levels WCAG 2.2 AA treats as release-blocking. "Moderate"/"minor"
 * findings aren't asserted on here; they're tracked and fixed opportunistically instead.
 */
async function expectNoSeriousViolations(page: Page, routeLabel: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (violation) =>
          `- [${String(violation.impact)}] ${violation.id}: ${violation.help} (${violation.nodes.length.toString()} node(s))`,
      )
      .join("\n");
    throw new Error(
      `${routeLabel} has ${blocking.length.toString()} blocking a11y violation(s):\n${summary}`,
    );
  }
}

test.describe("accessibility (NFR-09)", () => {
  test("signed-out routes", async ({ page }) => {
    await page.goto("/sign-in");
    await waitForHydration(page);
    await expectNoSeriousViolations(page, "/sign-in");

    const inviter = await seedMember();
    await signInAsExisting(page, inviter.email);
    await page.goto("/settings/invites");
    await waitForHydration(page);
    const checkpoint = logCheckpoint();
    await page.getByLabel("Email").fill(uniqueEmail("a11y-invitee"));
    await page.getByRole("button", { name: "Send invite" }).click();
    const inviteUrl = await waitForInviteLink(checkpoint);

    // A fresh, signed-out context - the invite-accept page's own audience.
    const context = await page.context().browser()?.newContext();
    if (!context) throw new Error("Could not open a fresh browser context");
    const invitePage = await context.newPage();
    await invitePage.goto(inviteUrl);
    await waitForHydration(invitePage);
    await expectNoSeriousViolations(invitePage, "/invite/accept");
    await context.close();
  });

  test("core member routes", async ({ page }) => {
    const member = await seedMember();
    await signInAsExisting(page, member.email);

    const routes = [
      "/feed",
      "/groups",
      "/businesses",
      "/calendar",
      "/marketplace",
      "/messages",
      "/notifications",
      `/profile/${member.id}`,
      "/settings/profile",
    ];
    for (const route of routes) {
      await page.goto(route);
      await waitForHydration(page);
      await expectNoSeriousViolations(page, route);
    }
  });

  test("detail pages for real content", async ({ page }) => {
    const member = await seedMember();
    const group = await seedGroup(member.id);
    const business = await seedBusiness(member.id);
    const event = await seedEvent(member.id);
    const listing = await seedListing(member.id);

    await signInAsExisting(page, member.email);

    const routes = [
      `/groups/${group.slug}`,
      `/businesses/${business.slug}`,
      `/calendar/${event.id}`,
      `/marketplace/${listing.id}`,
    ];
    for (const route of routes) {
      await page.goto(route);
      await waitForHydration(page);
      await expectNoSeriousViolations(page, route);
    }
  });

  test("admin routes", async ({ page }) => {
    const admin = await seedMember("admin");
    await signInAsExisting(page, admin.email);
    await page.goto("/admin/reports");
    await waitForHydration(page);
    await expectNoSeriousViolations(page, "/admin/reports");
  });
});
