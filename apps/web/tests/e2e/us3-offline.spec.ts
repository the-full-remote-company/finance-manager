import { expect, test, type Page } from "@playwright/test";
import { registerAndConfirm } from "../support/account.js";

/**
 * Story 3 scenarios 7–8, FR-035a–FR-035e, SC-011 (T091): the app launches
 * with the network disabled; a previously viewed month renders within 2 s
 * marked with its retrieval time; a month never visited shows "not available
 * offline", distinct from "no data"; a save attempt fails immediately with
 * `OFFLINE_READ_ONLY` and nothing is queued; sign-out destroys every cache.
 */

async function registerFreshUser(page: Page, label: string): Promise<void> {
  await registerAndConfirm(page, { prefix: "offline", label, displayName: "Offline Test" });
}

async function setUpWorkspace(page: Page): Promise<void> {
  await page.goto("/settings/accounts");
  await page.locator("form").getByLabel("Name", { exact: true }).fill("Girokonto");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  await expect(page.getByRole("cell", { name: "Girokonto" })).toBeVisible();

  await page.goto("/settings/categories");
  await page.locator("form").getByLabel("Name", { exact: true }).fill("Wohnen");
  await page.locator("form").getByLabel("Richtung").selectOption({ label: "Ausgabe" });
  await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
  await expect(page.getByRole("cell", { name: "Wohnen" })).toBeVisible();

  const now = new Date();
  const startDate = `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  await page.goto("/commitments/new");
  await page.locator("form").getByLabel("Name", { exact: true }).fill("Miete");
  await page.getByLabel("Kategorie").selectOption({ label: "Wohnen" });
  await page.getByLabel("Startdatum").fill(startDate);
  await page.getByLabel("Betrag in Euro").fill("950,00");
  await page.getByRole("button", { name: "Verpflichtung anlegen" }).click();
  await page.waitForURL("**/commitments");
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
}

test.describe("US3: offline read-only dashboard (Story 3 scenarios 7–8)", () => {
  test("a previously viewed month renders within 2s offline, marked with its retrieval time", async ({
    page,
    context,
  }) => {
    await registerFreshUser(page, "cached-month");
    await setUpWorkspace(page);

    await page.goto("/dashboard");
    await expect(page.getByTestId("retrieved-at")).toBeVisible();
    await waitForServiceWorkerControl(page);
    // The very first navigation to a route can predate the service worker's
    // own activation (a timing race, not a defect): reloading once more,
    // still online, guarantees this exact request passes through an already
    // -active worker so the navigation document itself — not just its data —
    // is the one cached for the offline reload below (ADR 0006).
    await page.reload();
    await expect(page.getByTestId("retrieved-at")).toBeVisible();
    // The SW's `cacheWillUpdate` runs asynchronously after the response
    // reaches the page; give it a moment to finish writing before going
    // offline, or the very request this test depends on is the one never
    // cached.
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    try {
      const start = Date.now();
      await page.reload();
      await expect(page.getByTestId("retrieved-at")).toBeVisible();
      const elapsedMs = Date.now() - start;
      expect(elapsedMs, `rendered in ${String(elapsedMs)}ms`).toBeLessThan(2000);
      await expect(page.getByText("950,00").first()).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("a month never visited shows 'not available offline', distinct from 'no data'", async ({
    page,
    context,
  }) => {
    await registerFreshUser(page, "uncached-month");
    await setUpWorkspace(page);

    await page.goto("/dashboard");
    await expect(page.getByTestId("retrieved-at")).toBeVisible();
    await waitForServiceWorkerControl(page);
    // Lets the background prefetch of the neighbouring months (T097) finish
    // and be cached, so the first offline step below still succeeds and only
    // the second genuinely has nothing cached.
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    try {
      const next = page.getByTestId("month-nav").getByRole("button", { name: "Nächster Monat" });
      await next.click();
      await expect(page.getByTestId("retrieved-at")).toBeVisible();

      await next.click();
      await expect(
        page.getByText("Für diesen Monat liegen keine Offline-Daten vor."),
      ).toBeVisible();
      // Distinct from "no data": the empty-state copy for a real, fetched
      // answer never appears for this month.
      await expect(page.getByText("Keine Ausgaben in diesem Monat.")).not.toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("a save attempt offline fails immediately with an explanation, and the input is kept", async ({
    page,
    context,
  }) => {
    await registerFreshUser(page, "save-offline");

    await page.goto("/settings/accounts");
    await page.locator("form").getByLabel("Name", { exact: true }).fill("Sparkonto");

    await context.setOffline(true);
    try {
      const start = Date.now();
      await page.getByRole("button", { name: "Konto hinzufügen" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      const elapsedMs = Date.now() - start;
      // Failed immediately by the service worker's synthesised
      // `OFFLINE_READ_ONLY`, not left to hang to a transport timeout.
      expect(elapsedMs, `failed in ${String(elapsedMs)}ms`).toBeLessThan(3000);

      // Nothing queued, nothing saved: the typed input is still on screen,
      // and a fresh online reload confirms no account exists.
      await expect(page.locator("form").getByLabel("Name", { exact: true })).toHaveValue(
        "Sparkonto",
      );
    } finally {
      await context.setOffline(false);
    }

    await page.reload();
    await expect(page.getByRole("cell", { name: "Sparkonto" })).not.toBeVisible();
  });

  test("sign-out destroys every cache", async ({ page }) => {
    await registerFreshUser(page, "sign-out");
    await setUpWorkspace(page);

    await page.goto("/dashboard");
    await expect(page.getByTestId("retrieved-at")).toBeVisible();
    await waitForServiceWorkerControl(page);
    await page.waitForTimeout(1000);

    const cacheKeysBefore = await page.evaluate(() => caches.keys());
    expect(cacheKeysBefore.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.waitForURL("**/sign-in");

    const cacheKeysAfter = await page.evaluate(() => caches.keys());
    expect(cacheKeysAfter).toEqual([]);
  });
});
