import { defineConfig, devices } from "@playwright/test";

/**
 * Article IV: "every end-to-end test run MUST include an automated
 * accessibility scan, and any violation at serious or critical severity fails
 * the build". The scan helper lives in apps/web/tests/support/a11y.ts; this
 * file only guarantees the runner exists, runs against a real server, and runs
 * at a mobile viewport as well as a desktop one — FR-035 and SC-006 are both
 * stated about a phone.
 */
export default defineConfig({
  testDir: "./apps/web/tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Built, not dev: the service worker is inactive in dev, and every offline
    // assertion in US3 depends on it (ADR 0006).
    command: "pnpm --filter @finance/web build && pnpm --filter @finance/web start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
