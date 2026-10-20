import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../support/a11y.js";
import { registerAndConfirm } from "../support/account.js";

/**
 * Story 2, Independent Test: "Enter one income and one expense, reopen the
 * list, and confirm both persist with every field intact." (T076)
 *
 * SC-005's "add a commitment on a phone in under 60 seconds" (T086) is
 * measured in the same spec, on the `mobile` project's Pixel 7 viewport,
 * because it is the same user journey timed rather than a separate one.
 */

async function registerFreshUser(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  await registerAndConfirm(page, { prefix: "capture", label, displayName: "Capture Test" });
}

test.describe("US2: capture what I am committed to (Story 2)", () => {
  test("an account, a category and a monthly expense persist with every field intact", async ({
    page,
  }) => {
    await registerFreshUser(page, "persist");

    await page.goto("/settings/accounts");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

    await page.goto("/settings/categories");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Wohnen");
    await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Wohnen" })).toBeVisible();

    await page.goto("/commitments");
    await page.getByRole("link", { name: "Neue Verpflichtung" }).click();
    await page.waitForURL("**/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Miete");
    await page.getByLabel("Startdatum").fill("2026-01-01");
    await page.getByLabel("Betrag in Euro").fill("950,00");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    // Reopen the list from scratch — a fresh navigation, not the same
    // in-memory state the create form just populated.
    await page.goto("/commitments");
    const row = page.getByRole("row").filter({ hasText: "Miete" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "Wohnen" })).toBeVisible();
    await expect(row.getByRole("cell", { name: "Girokonto" })).toBeVisible();
    await expect(row.getByRole("cell", { name: "Monatlich" })).toBeVisible();

    // German locale formatting with a euro symbol on the persisted amount.
    // An expense's literal money direction is a minus sign (FR-043), not a
    // hidden property — asserted as a substring so the exact minus glyph
    // (Intl's, not necessarily ASCII "-") doesn't have to be pinned here.
    await expect(row).toContainText("950,00");
    await expect(row).toContainText("€");
  });

  test("a missing required field is refused with a visible message", async ({ page }) => {
    await registerFreshUser(page, "missing-field");

    await page.goto("/settings/accounts");
    // Submit with no name at all.
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();

    // The native `required` attribute blocks submission client-side, and
    // reports it through the browser's own validation UI, which is itself an
    // accessible, visible message — not a silent no-op.
    const nameField = page.locator("form").getByLabel("Name", { exact: true });
    const isValid = await nameField.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);

    const validationMessage = await nameField.evaluate(
      (el: HTMLInputElement) => el.validationMessage,
    );
    expect(validationMessage.length).toBeGreaterThan(0);
  });

  test("has no serious or critical accessibility violation on capture screens", async ({
    page,
  }) => {
    await registerFreshUser(page, "a11y");

    await page.goto("/settings/accounts");
    await expectNoSeriousA11yViolations(page, "/settings/accounts");

    await page.goto("/settings/categories");
    await expectNoSeriousA11yViolations(page, "/settings/categories");

    await page.goto("/commitments");
    await expectNoSeriousA11yViolations(page, "/commitments");

    await page.goto("/commitments/new");
    await expectNoSeriousA11yViolations(page, "/commitments/new");
  });

  test("adds a commitment on a phone in under 60 seconds (SC-005)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "SC-005 is stated about a phone");

    await registerFreshUser(page, "sc005");

    await page.goto("/settings/accounts");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

    await page.goto("/settings/categories");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Wohnen");
    await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Wohnen" })).toBeVisible();

    // The clock starts once setup exists — SC-005 measures adding a
    // commitment, not first-time account/category setup.
    await page.goto("/commitments");
    const start = Date.now();

    await page.getByRole("link", { name: "Neue Verpflichtung" }).click();
    await page.waitForURL("**/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Miete");
    await page.getByLabel("Startdatum").fill("2026-01-01");
    await page.getByLabel("Betrag in Euro").fill("950,00");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");
    await expect(page.getByRole("cell", { name: "Miete" })).toBeVisible();

    const elapsedSeconds = (Date.now() - start) / 1000;
    expect(elapsedSeconds, `took ${elapsedSeconds.toFixed(1)}s`).toBeLessThan(60);
  });
});
