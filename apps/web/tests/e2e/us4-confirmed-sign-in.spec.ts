import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "../support/a11y.js";
import {
  PASSWORD,
  confirmationTokensFor,
  confirmInBrowser,
  registerAndConfirm,
  submitRegistration,
  uniqueEmail,
} from "../support/account.js";

/**
 * Feature 002, User Story 4 (T035, T037): a confirmed account signs in and out
 * exactly as before; an unconfirmed one is told so, only after the password was
 * right, and can ask for a new link from the sign-in screen itself.
 *
 * The regression half of T035, "feature 001's isolation scenarios against a
 * confirmed account", is `us1-isolation.spec.ts`, which registers and confirms
 * through the real flow for every account it creates. It needed no change
 * beyond that, and failing there would fail this feature's gate too.
 */
const SESSION_COOKIE = "__Host-session";
const NOT_CONFIRMED = "Dieses Konto wurde noch nicht bestätigt";
const AUTH_FAILED = "Anmeldung fehlgeschlagen. E-Mail-Adresse oder Passwort ist falsch.";

// The sign-in form's own error region, not `getByRole("alert")`: Next's route
// announcer carries that role as well.
const formAlert = (page: Page) => page.locator('form div[role="alert"]');

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

async function hasSession(page: Page): Promise<boolean> {
  return (await page.context().cookies()).some((cookie) => cookie.name === SESSION_COOKIE);
}

test.describe("Feature 002 US4: sign-in and confirmation state", () => {
  test("a confirmed account signs out and signs in again, as before", async ({ page }) => {
    const email = await registerAndConfirm(page, {
      prefix: "signin",
      label: "confirmed",
      displayName: "Sign In Test",
    });

    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.waitForURL("**/sign-in");
    expect(await hasSession(page)).toBe(false);

    await signIn(page, email, PASSWORD);

    await page.waitForURL("**/dashboard");
    expect(await hasSession(page)).toBe(true);
    await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
  });

  test("an unconfirmed account with the right password is told so, with a way to ask again (T037)", async ({
    page,
  }) => {
    const email = uniqueEmail("signin", "unconfirmed");
    await submitRegistration(page, { email, displayName: "Unconfirmed Test" });
    const [first = ""] = await confirmationTokensFor(page.request, email, 1);

    await signIn(page, email, PASSWORD);

    await expect(formAlert(page)).toContainText(NOT_CONFIRMED);
    expect(page.url()).toContain("/sign-in");
    expect(await hasSession(page)).toBe(false);
    await expectNoSeriousA11yViolations(page, "/sign-in (not confirmed)");
    await expectTouchTargets(page);

    await page.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }).click();
    await expect(formAlert(page)).toContainText("Bestätigungs-E-Mail wurde versendet.");
    await expect(formAlert(page)).not.toContainText(NOT_CONFIRMED);

    // A real, working link arrived, and the old one is dead.
    const tokens = await confirmationTokensFor(page.request, email, 2);
    expect(tokens[1]).not.toBe(first);
    await confirmInBrowser(page, tokens[1] ?? "");
    expect(await hasSession(page)).toBe(true);
  });

  test("a wrong password on an unconfirmed account looks exactly like one on an unknown address", async ({
    page,
  }) => {
    const unconfirmed = uniqueEmail("signin", "wrongpw");
    await submitRegistration(page, { email: unconfirmed, displayName: "Wrong Password Test" });

    await signIn(page, unconfirmed, "not the password at all");
    await expect(formAlert(page)).toBeVisible();
    const forUnconfirmed = (await formAlert(page).innerText()).trim();

    await signIn(page, uniqueEmail("signin", "nobody"), "not the password at all");
    await expect(formAlert(page)).toBeVisible();
    const forUnknown = (await formAlert(page).innerText()).trim();

    expect(forUnconfirmed).toContain(AUTH_FAILED);
    expect(forUnconfirmed).not.toContain(NOT_CONFIRMED);
    expect(forUnknown).toBe(forUnconfirmed);
    // No resend offer either: that would single the account out.
    await expect(
      page.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }),
    ).toHaveCount(0);
    expect(await hasSession(page)).toBe(false);
  });
});
