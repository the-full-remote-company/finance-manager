import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "../support/a11y.js";
import {
  confirmInBrowser,
  latestConfirmationToken,
  submitRegistration,
  uniqueEmail,
} from "../support/account.js";

/**
 * Feature 002, User Story 1 (T017): register, receive the email, confirm
 * explicitly, land on the dashboard. No session exists until the confirm
 * button is pressed (FR-001, FR-006), and a link that was already used is
 * simply no longer valid (spec scenario 4, FR-007).
 */
const SESSION_COOKIE = "__Host-session";

async function hasSession(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some((cookie) => cookie.name === SESSION_COOKIE);
}

test.describe("Feature 002 US1: confirm an email address before first use", () => {
  test("register, read the email, confirm, and arrive on the dashboard", async ({ page }) => {
    const email = uniqueEmail("confirm", "happy");

    await submitRegistration(page, { email, displayName: "Confirm Test" });

    // The deliberate "check your email" state: heading, the address, a resend
    // action (spec scenario 2). Not a bare status line.
    await expect(page.getByText(email)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/register (check your email)");
    await expectTouchTargets(page);

    // No session yet, and the app is not reachable.
    expect(await hasSession(page)).toBe(false);
    await page.goto("/dashboard");
    await page.waitForURL("**/sign-in");

    const token = await latestConfirmationToken(page.request, email);
    await page.goto(`/confirm?token=${token}`);
    await expect(page.getByRole("heading", { name: "E-Mail-Adresse bestätigen" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/confirm");
    await expectTouchTargets(page);
    expect(await hasSession(page)).toBe(false);

    await page.getByRole("button", { name: "Konto bestätigen" }).click();
    await page.waitForURL("**/dashboard");

    expect(await hasSession(page)).toBe(true);
    await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dashboard (after confirmation)");
  });

  test("opening the link does not confirm anything: a link scanner cannot activate an account (FR-006)", async ({
    page,
  }) => {
    const email = uniqueEmail("confirm", "scanner");
    await submitRegistration(page, { email, displayName: "Scanner Test" });
    const token = await latestConfirmationToken(page.request, email);

    // What a mail scanner or link-preview bot does: fetch the page, repeatedly.
    await page.goto(`/confirm?token=${token}`);
    await page.reload();
    await page.goto(`/confirm?token=${token}`);

    expect(page.url()).toContain("/confirm");
    expect(await hasSession(page)).toBe(false);

    // The token was not consumed by any of that: the person can still confirm.
    await page.getByRole("button", { name: "Konto bestätigen" }).click();
    await page.waitForURL("**/dashboard");
    expect(await hasSession(page)).toBe(true);
  });

  test("confirming in a different browser works and leaves the registering one signed out (T040)", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("confirm", "elsewhere");
    await submitRegistration(page, { email, displayName: "Elsewhere Test" });
    const token = await latestConfirmationToken(page.request, email);

    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await confirmInBrowser(otherPage, token);
      expect(await hasSession(otherPage)).toBe(true);
    } finally {
      await other.close();
    }

    expect(await hasSession(page)).toBe(false);
  });

  test("a link that was already used is no longer valid and creates no session (spec scenario 4)", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("confirm", "reuse");
    await submitRegistration(page, { email, displayName: "Reuse Test" });
    const token = await latestConfirmationToken(page.request, email);

    const first = await browser.newContext();
    try {
      await confirmInBrowser(await first.newPage(), token);
    } finally {
      await first.close();
    }

    await page.goto(`/confirm?token=${token}`);
    await page.getByRole("button", { name: "Konto bestätigen" }).click();

    await expect(page.locator('p[role="alert"]')).toContainText(
      "Ungültiger oder abgelaufener Bestätigungslink",
    );
    await expect(
      page.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }),
    ).toBeVisible();
    expect(await hasSession(page)).toBe(false);
    await expectNoSeriousA11yViolations(page, "/confirm (invalid link)");
    await expectTouchTargets(page);
  });

  test("a made-up link is refused with an explanation and a way to ask again (FR-007)", async ({
    page,
  }) => {
    await page.goto("/confirm?token=00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAA");
    await page.getByRole("button", { name: "Konto bestätigen" }).click();

    await expect(page.locator('p[role="alert"]')).toContainText(
      "Ungültiger oder abgelaufener Bestätigungslink",
    );
    expect(await hasSession(page)).toBe(false);
  });

  test("the page without any token explains itself instead of showing a dead button", async ({
    page,
  }) => {
    await page.goto("/confirm");

    await expect(page.locator('p[role="alert"]')).toContainText(
      "Ungültiger oder abgelaufener Bestätigungslink",
    );
    await expect(page.getByRole("button", { name: "Konto bestätigen" })).toHaveCount(0);
  });
});
