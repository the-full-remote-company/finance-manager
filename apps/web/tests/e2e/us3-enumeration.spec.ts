import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  confirmationTokensFor,
  confirmInBrowser,
  submitRegistration,
  uniqueEmail,
} from "../support/account.js";

/**
 * Feature 002, User Story 3 (T031): registering an address that already has an
 * account, confirmed or not, looks the same as registering a new one: the same
 * screen, no session, and no email to the address's owner (ADR 0003, FR-011).
 */
const SESSION_COOKIE = "__Host-session";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function mailCountFor(page: Page, email: string): Promise<number> {
  const response = await page.request.get(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  return ((await response.json()) as { messages: unknown[] }).messages.length;
}

/** What the person sees on the "check your email" screen, with their address masked. */
async function screenText(page: Page, email: string): Promise<string> {
  return (await page.locator("main").innerText()).split(email).join("<ADDRESS>");
}

async function inFreshBrowser<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

test.describe("Feature 002 US3: registration does not reveal existing accounts", () => {
  for (const state of ["confirmed", "unconfirmed"] as const) {
    test(`registering a ${state} address again looks like a genuine registration`, async ({
      page,
      browser,
    }) => {
      const email = uniqueEmail("enum", state);

      // The genuine registration, and what it shows.
      await submitRegistration(page, { email, displayName: "First" });
      const [token = ""] = await confirmationTokensFor(page.request, email, 1);
      const genuineScreen = await screenText(page, email);

      if (state === "confirmed") {
        await inFreshBrowser(browser, (other) => confirmInBrowser(other, token));
      }

      // The duplicate, from a browser with no history.
      const { duplicateScreen, hasSession } = await inFreshBrowser(browser, async (other) => {
        await submitRegistration(other, { email, displayName: "Impostor" });
        return {
          duplicateScreen: await screenText(other, email),
          hasSession: (await other.context().cookies()).some((c) => c.name === SESSION_COOKIE),
        };
      });

      // Not vacuous: the genuine screen really is the "check your email" one.
      expect(genuineScreen).toContain("Bestätigungslink wurde versendet");
      expect(genuineScreen).toContain("<ADDRESS>");
      expect(duplicateScreen).toBe(genuineScreen);
      expect(hasSession).toBe(false);

      // Sending is asynchronous: give a mail that would have been sent time to
      // arrive before asserting that none did. Exactly the one from the genuine
      // registration exists, and the owner got no "someone tried" notice.
      await page.waitForTimeout(1500);
      expect(await mailCountFor(page, email)).toBe(1);
    });
  }

  test("the resend button on a duplicate's screen answers the same and sends nothing", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("enum", "resend-dup");
    await submitRegistration(page, { email, displayName: "First" });
    const [token = ""] = await confirmationTokensFor(page.request, email, 1);
    await inFreshBrowser(browser, (other) => confirmInBrowser(other, token));

    await inFreshBrowser(browser, async (other) => {
      await submitRegistration(other, { email, displayName: "Impostor" });
      await other.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }).click();
      await expect(other.locator('p[role="status"]')).toContainText(
        "Neue Bestätigungs-E-Mail wurde versendet.",
      );
    });

    await page.waitForTimeout(1500);
    // The address is confirmed, so a resend has nothing to send.
    expect(await mailCountFor(page, email)).toBe(1);
  });
});
