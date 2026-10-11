import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../support/a11y.js";

/**
 * Story 4, Independent Test: "Enter a quarterly commitment of 66,03 €
 * anchored to January. Verify the smoothed view shows 22,01 € in every
 * month, the cash view shows 66,03 € in January, April, July and October and
 * nothing in the other months, and that both views total 264,12 € over
 * twelve months." (T107)
 */

async function registerFreshUser(page: Page, label: string): Promise<void> {
  const email = `rhythms-${label}-${String(Date.now())}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Anzeigename").fill("Rhythms Test");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill("correct horse battery");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByText("Fast geschafft").first().waitFor();
}

function currentMonth(): { date: string; month: string } {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return { date: `${year}-${month}-01`, month: `${year}-${month}` };
}

async function setUpAccountAndCategory(page: Page): Promise<void> {
  await page.goto("/settings/accounts");
  await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

  await page.goto("/settings/categories");
  await page.locator("form").getByLabel("Name", { exact: true }).fill("Versicherung");
  await page.locator("form").getByLabel("Richtung").selectOption({ label: "Ausgabe" });
  await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
  await expect(page.getByRole("cell", { name: "Versicherung" })).toBeVisible();
}

test.describe("US4: handle payments that are not monthly (Story 4)", () => {
  test("a quarterly commitment shows 66,03 € in the cash view and 22,01 € in the smoothed view", async ({
    page,
  }) => {
    await registerFreshUser(page, "quarterly");
    await setUpAccountAndCategory(page);

    const { date, month } = currentMonth();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Hausratversicherung");
    await page.getByLabel("Kategorie").selectOption({ label: "Versicherung" });
    await page.getByLabel("Rhythmus").selectOption({ label: "Vierteljährlich" });
    await page.getByLabel("Ankermonat").fill(month);
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("66,03");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    await page.goto("/dashboard");
    // Cash is the default presentation: the full charge in the anchor month.
    await expect(page.getByText("66,03").first()).toBeVisible();

    await page.getByRole("button", { name: "Geglättet" }).click();
    await expect(page.getByText("22,01").first()).toBeVisible();
    // The cash figure is gone once smoothed is selected for this due month.
    await expect(page.getByText("66,03")).not.toBeVisible();

    // The following (non-due) month still shows the smoothed share, but
    // nothing in the cash view.
    await page.getByTestId("month-nav").getByRole("button", { name: "Nächster Monat" }).click();
    await expect(page.getByText("22,01").first()).toBeVisible();

    await page.getByRole("button", { name: "Kassenwirksam" }).click();
    await expect(page.getByText("Keine Ausgaben in diesem Monat.")).toBeVisible();
  });

  test("a non-monthly rhythm without an anchor month is refused client-side", async ({ page }) => {
    await registerFreshUser(page, "anchor-missing");
    await setUpAccountAndCategory(page);

    const { date } = currentMonth();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Hausratversicherung");
    await page.getByLabel("Kategorie").selectOption({ label: "Versicherung" });
    await page.getByLabel("Rhythmus").selectOption({ label: "Vierteljährlich" });
    // Anchor month deliberately left empty.
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("66,03");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();

    const anchorField = page.locator("#commitment-anchor-month");
    const isValid = await anchorField.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);
    const validationMessage = await anchorField.evaluate(
      (el: HTMLInputElement) => el.validationMessage,
    );
    expect(validationMessage.length).toBeGreaterThan(0);
    // Refused, not silently accepted: still on the create form.
    await expect(page).toHaveURL(/\/commitments\/new$/);
  });

  test("the chosen presentation is retained across month navigation and a session restart (FR-030)", async ({
    page,
  }) => {
    await registerFreshUser(page, "retained");
    await setUpAccountAndCategory(page);

    const { date, month } = currentMonth();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Hausratversicherung");
    await page.getByLabel("Kategorie").selectOption({ label: "Versicherung" });
    await page.getByLabel("Rhythmus").selectOption({ label: "Vierteljährlich" });
    await page.getByLabel("Ankermonat").fill(month);
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("66,03");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Geglättet" }).click();
    await expect(page.getByRole("button", { name: "Geglättet" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByTestId("month-nav").getByRole("button", { name: "Nächster Monat" }).click();
    await expect(page.getByRole("button", { name: "Geglättet" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A session restart: a fresh navigation, not the same in-memory state.
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Geglättet" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("has no serious or critical accessibility violation with a non-monthly commitment on the dashboard", async ({
    page,
  }) => {
    await registerFreshUser(page, "a11y");
    await setUpAccountAndCategory(page);

    const { date, month } = currentMonth();
    await page.goto("/commitments/new");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Hausratversicherung");
    await page.getByLabel("Kategorie").selectOption({ label: "Versicherung" });
    await page.getByLabel("Rhythmus").selectOption({ label: "Vierteljährlich" });
    await page.getByLabel("Ankermonat").fill(month);
    await page.getByLabel("Startdatum").fill(date);
    await page.getByLabel("Betrag in Euro").fill("66,03");
    await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
    await page.waitForURL("**/commitments");

    await page.goto("/dashboard");
    await expect(page.getByText("66,03").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dashboard (quarterly commitment)");
  });
});
