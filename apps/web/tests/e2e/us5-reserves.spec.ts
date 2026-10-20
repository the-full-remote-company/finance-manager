import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../support/a11y.js";
import { registerAndConfirm } from "../support/account.js";

/**
 * Story 5, Independent Test: "Mark one commitment inside an otherwise-expense
 * category as a reserve; verify it leaves that category's expense total,
 * joins the reserves total, and that expenses plus reserves equals the
 * previous combined total." (T115)
 */

async function registerFreshUser(page: Page, label: string): Promise<void> {
  await registerAndConfirm(page, { prefix: "reserves", label, displayName: "Reserves Test" });
}

function currentMonthStartDate(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

test.describe("US5: separate money set aside from money spent (Story 5)", () => {
  test("flipping a commitment's kind to reserve moves every affected total (Story 5 scenario 4)", async ({
    page,
  }) => {
    await registerFreshUser(page, "flip");

    await page.goto("/settings/accounts");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

    await page.goto("/settings/categories");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Sparen");
    await page.locator("form").getByLabel("Richtung").selectOption({ label: "Ausgabe" });
    await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Sparen" })).toBeVisible();

    const date = currentMonthStartDate();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("ETF-Sparplan");
    await page.getByLabel("Kategorie").selectOption({ label: "Sparen" });
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("200,00");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    // Before: an ordinary expense. It shows up in "Ausgaben", nothing in
    // "Rücklagen" (the section doesn't even render with nothing to show).
    await page.goto("/dashboard");
    await expect(page.getByText("200,00").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rücklagen" })).not.toBeVisible();

    // Flip it to a reserve.
    await page.goto("/commitments");
    await page.getByRole("link", { name: "Bearbeiten" }).click();
    await page.getByLabel("Art", { exact: true }).selectOption({ label: "Rücklage" });
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await page.waitForURL("**/commitments");

    // After: it has left the expense total and joined the reserves total.
    await page.goto("/dashboard");
    await expect(page.getByText("Keine Ausgaben in diesem Monat.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rücklagen" })).toBeVisible();
    await expect(page.getByText("200,00").first()).toBeVisible();
    await expect(page.getByText("Rücklage").first()).toBeVisible();
  });

  test("has no serious or critical accessibility violation with a reserve on the dashboard", async ({
    page,
  }) => {
    await registerFreshUser(page, "a11y");

    await page.goto("/settings/accounts");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

    await page.goto("/settings/categories");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Sparen");
    await page.locator("form").getByLabel("Richtung").selectOption({ label: "Ausgabe" });
    await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
    await expect(page.getByRole("cell", { name: "Sparen" })).toBeVisible();

    const date = currentMonthStartDate();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("ETF-Sparplan");
    await page.getByLabel("Kategorie").selectOption({ label: "Sparen" });
    await page.getByLabel("Art", { exact: true }).selectOption({ label: "Rücklage" });
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("200,00");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    await page.goto("/dashboard");
    await expect(page.getByText("200,00").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dashboard (reserve)");
  });
});
