import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../support/a11y.js";

/**
 * Story 3, Independent Test: "With a known set of commitments, open a month
 * and verify each category total equals the sum of its commitments for that
 * month, and that the percentages match those totals divided by that month's
 * income." (T090)
 */

async function registerFreshUser(page: Page, label: string): Promise<void> {
  const email = `dashboard-${label}-${String(Date.now())}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Anzeigename").fill("Dashboard Test");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill("correct horse battery");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByText("Fast geschafft").first().waitFor();
}

function currentMonthStartDate(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

async function createAccount(page: Page, name: string): Promise<void> {
  await page.goto("/settings/accounts");
  await page.locator("form").getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  await expect(page.getByRole("cell", { name })).toBeVisible();
}

async function createCategory(
  page: Page,
  name: string,
  direction: "Einnahme" | "Ausgabe",
): Promise<void> {
  await page.goto("/settings/categories");
  await page.locator("form").getByLabel("Name", { exact: true }).fill(name);
  await page.locator("form").getByLabel("Richtung").selectOption({ label: direction });
  await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
  await expect(page.getByRole("cell", { name })).toBeVisible();
}

async function createCommitment(
  page: Page,
  opts: { name: string; direction: "Einnahme" | "Ausgabe"; category: string; amount: string },
): Promise<void> {
  await page.goto("/commitments/new");
  await page.locator("form").getByLabel("Name", { exact: true }).fill(opts.name);
  await page.getByLabel("Richtung").selectOption({ label: opts.direction });
  await page.getByLabel("Kategorie").selectOption({ label: opts.category });
  await page.getByLabel("Startdatum").fill(currentMonthStartDate());
  await page.getByLabel("Betrag in Euro").fill(opts.amount);
  await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
  await page.waitForURL("**/commitments");
}

test.describe("US3: see a month summarised by category (Story 3)", () => {
  test("category totals and percentages match a known fixture", async ({ page }) => {
    await registerFreshUser(page, "fixture");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Gehalt", "Einnahme");
    await createCategory(page, "Wohnen", "Ausgabe");

    await createCommitment(page, {
      name: "Gehalt",
      direction: "Einnahme",
      category: "Gehalt",
      amount: "3000,00",
    });
    await createCommitment(page, {
      name: "Miete",
      direction: "Ausgabe",
      category: "Wohnen",
      amount: "950,00",
    });

    await page.goto("/dashboard");

    await expect(page.getByText("3.000,00").first()).toBeVisible();
    await expect(page.getByText("950,00").first()).toBeVisible();
    // 950 / 3000 = 31.67 %, rounded to the nearest whole per cent (FR-033).
    await expect(page.getByText("32 %")).toBeVisible();
    // remaining = 3000 - 950 = 2050,00 €, shown as a positive figure.
    await expect(page.getByText("2.050,00").first()).toBeVisible();
  });

  test("a zero-income month suppresses percentages rather than showing an error or zero", async ({
    page,
  }) => {
    await registerFreshUser(page, "zero-income");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Wohnen", "Ausgabe");
    await createCommitment(page, {
      name: "Miete",
      direction: "Ausgabe",
      category: "Wohnen",
      amount: "500,00",
    });

    await page.goto("/dashboard");

    await expect(page.getByText("500,00").first()).toBeVisible();
    // The staleness indicator is its own `.pill` (T100); a percentage pill
    // would be a second one, specifically inside the expense category row.
    await expect(page.getByText("Wohnen").locator("..").locator(".pill")).toHaveCount(0);
  });

  test("month navigation stops at the horizon boundary with a clear indication", async ({
    page,
  }) => {
    await registerFreshUser(page, "boundary");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Wohnen", "Ausgabe");

    await page.goto("/dashboard");
    const nav = page.getByTestId("month-nav");
    const next = nav.getByRole("button", { name: "Nächster Monat" });

    // 23 forward steps from the current month reaches the last month of the
    // rolling 24-month window (current + 11 months forward).
    for (let step = 0; step < 11; step += 1) {
      await next.click();
    }
    await expect(next).toBeDisabled();
    await expect(page.getByText("Dies ist der späteste verfügbare Monat.")).toBeVisible();
  });

  test("month navigation preserves the user's scroll position", async ({ page }) => {
    await registerFreshUser(page, "scroll");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Gehalt", "Einnahme");
    // Several categories so the page is tall enough to scroll.
    for (const name of ["Wohnen", "Freizeit", "Versicherung", "Mobilität", "Essen"]) {
      await createCategory(page, name, "Ausgabe");
    }
    await createCommitment(page, {
      name: "Gehalt",
      direction: "Einnahme",
      category: "Gehalt",
      amount: "3000,00",
    });
    for (const name of ["Wohnen", "Freizeit", "Versicherung", "Mobilität", "Essen"]) {
      await createCommitment(page, {
        name: `${name}-Posten`,
        direction: "Ausgabe",
        category: name,
        amount: "100,00",
      });
    }

    await page.setViewportSize({ width: 375, height: 500 });
    await page.goto("/dashboard");
    await expect(page.getByText("Wohnen").first()).toBeVisible();

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    expect(scrollYBefore).toBeGreaterThan(0);

    // Dispatched directly rather than via Playwright's `.click()`, which
    // first scrolls the target into view — that scroll is the test driver's
    // own actionability behaviour, not the app's, and would make this
    // assertion about the real thing it must prove. A real tap on a
    // statically positioned nav bar does not relocate the viewport either.
    await page
      .getByTestId("month-nav")
      .getByRole("button", { name: "Nächster Monat" })
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
    await page.waitForTimeout(200);
    const scrollYAfter = await page.evaluate(() => window.scrollY);

    // The month switch is a client-state update, not a navigation: the
    // scroll position is never reset to the top of the page.
    expect(scrollYAfter).toBeGreaterThan(0);
  });

  test("no horizontal scrolling on a phone viewport (FR-035)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "FR-035 is stated about a phone");

    await registerFreshUser(page, "no-scroll");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Gehalt", "Einnahme");
    await createCategory(page, "Wohnen", "Ausgabe");
    await createCommitment(page, {
      name: "Gehalt",
      direction: "Einnahme",
      category: "Gehalt",
      amount: "3000,00",
    });
    await createCommitment(page, {
      name: "Miete",
      direction: "Ausgabe",
      category: "Wohnen",
      amount: "950,00",
    });

    await page.goto("/dashboard");
    await expect(page.getByText("950,00").first()).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("has no serious or critical accessibility violation on the dashboard", async ({ page }) => {
    await registerFreshUser(page, "a11y");
    await createAccount(page, "Girokonto");
    await createCategory(page, "Gehalt", "Einnahme");
    await createCategory(page, "Wohnen", "Ausgabe");
    await createCommitment(page, {
      name: "Gehalt",
      direction: "Einnahme",
      category: "Gehalt",
      amount: "3000,00",
    });
    await createCommitment(page, {
      name: "Miete",
      direction: "Ausgabe",
      category: "Wohnen",
      amount: "950,00",
    });

    await page.goto("/dashboard");
    await expect(page.getByText("950,00").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dashboard");
  });
});
