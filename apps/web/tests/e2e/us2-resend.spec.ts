import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "../support/a11y.js";
import {
  confirmationTokensFor,
  confirmInBrowser,
  submitRegistration,
  uniqueEmail,
} from "../support/account.js";

/**
 * Feature 002, User Story 2 (T025, T027, T028): a person whose email did not
 * arrive, or whose link expired, can ask for a new one; the old link stops
 * working; and asking repeatedly is throttled. The resend answers the same for
 * an address that has no account, so the form never says whether one exists.
 */
const RESEND_BUTTON = "Bestätigungs-E-Mail erneut senden";
const INVALID_LINK = "Ungültiger oder abgelaufener Bestätigungslink";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

// `p[role="status"]` / `p[role="alert"]`, not the bare roles: the app shell's
// live region and Next's route announcer carry the same roles, so the roles
// alone match more than one element.
const feedback = (page: Page) => page.locator('p[role="status"]');

async function mailCountFor(page: Page, email: string): Promise<number> {
  const response = await page.request.get(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  return ((await response.json()) as { messages: unknown[] }).messages.length;
}

test.describe("Feature 002 US2: resend a confirmation email", () => {
  test("the success screen resends: a new link arrives, the old one dies, the new one confirms", async ({
    page,
  }) => {
    const email = uniqueEmail("resend", "success-screen");
    await submitRegistration(page, { email, displayName: "Resend Test" });
    const [first = ""] = await confirmationTokensFor(page.request, email, 1);

    await page.getByRole("button", { name: RESEND_BUTTON }).click();

    await expect(feedback(page)).toContainText("Neue Bestätigungs-E-Mail wurde versendet.");
    await expectNoSeriousA11yViolations(page, "/register (after resend)");
    await expectTouchTargets(page);

    const tokens = await confirmationTokensFor(page.request, email, 2);
    expect(tokens).toHaveLength(2);
    const second = tokens[1] ?? "";
    expect(second).not.toBe(first);

    // The first link no longer works (FR-008)...
    await page.goto(`/confirm?token=${first}`);
    await page.getByRole("button", { name: "Konto bestätigen" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(INVALID_LINK);

    // ...and the second does.
    await confirmInBrowser(page, second);
    await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
  });

  test("a dead link offers a form to ask again, and the new link confirms (T028)", async ({
    page,
  }) => {
    const email = uniqueEmail("resend", "dead-link");
    await submitRegistration(page, { email, displayName: "Dead Link Test" });
    await confirmationTokensFor(page.request, email, 1);

    await page.goto("/confirm?token=00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAA");
    await page.getByRole("button", { name: "Konto bestätigen" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(INVALID_LINK);

    await page.getByLabel("E-Mail-Adresse für einen neuen Link").fill(email);
    await page.getByRole("button", { name: RESEND_BUTTON }).click();

    await expect(feedback(page)).toContainText("Falls zu dieser Adresse ein unbestätigtes Konto");
    await expectNoSeriousA11yViolations(page, "/confirm (resend sent)");
    await expectTouchTargets(page);

    const tokens = await confirmationTokensFor(page.request, email, 2);
    await confirmInBrowser(page, tokens[1] ?? "");
  });

  test("an address with no account gets the identical answer and no mail (FR-009)", async ({
    page,
  }) => {
    const known = uniqueEmail("resend", "known");
    const unknown = uniqueEmail("resend", "unknown");
    await submitRegistration(page, { email: known, displayName: "Known" });
    await confirmationTokensFor(page.request, known, 1);

    const answerFor = async (email: string): Promise<string> => {
      await page.goto("/confirm");
      await page.getByLabel("E-Mail-Adresse für einen neuen Link").fill(email);
      await page.getByRole("button", { name: RESEND_BUTTON }).click();
      return (await feedback(page).textContent()) ?? "";
    };

    const forKnown = await answerFor(known);
    const forUnknown = await answerFor(unknown);

    expect(forUnknown).not.toBe("");
    expect(forUnknown).toBe(forKnown);

    // Sending is asynchronous, so give a mail that would have been sent time to
    // arrive before asserting that none did.
    await confirmationTokensFor(page.request, known, 2);
    await page.waitForTimeout(1500);
    expect(await mailCountFor(page, unknown)).toBe(0);
    expect(await mailCountFor(page, known)).toBe(2);
  });

  test("asking over and over is throttled, and the screen says how long to wait (FR-010)", async ({
    page,
  }) => {
    const email = uniqueEmail("resend", "throttle");
    await submitRegistration(page, { email, displayName: "Throttle Test" });

    const button = page.getByRole("button", { name: RESEND_BUTTON });
    let throttled = false;
    for (let click = 0; click < 15 && !throttled; click += 1) {
      await button.click();
      await expect(feedback(page)).toBeVisible();
      throttled = /Zu viele Versuche/.test((await feedback(page).textContent()) ?? "");
    }

    expect(throttled, "the throttle never engaged within 15 resends").toBe(true);
    await expect(feedback(page)).toContainText("Sekunden erneut versuchen");
    await expectNoSeriousA11yViolations(page, "/register (throttled)");
  });
});
