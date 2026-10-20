import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Feature 002: registration no longer signs anyone in. A spec that needs a
 * signed-in user must do what a person does: register, take the link from the
 * confirmation email, and press the confirm button. Mailpit (docker-compose)
 * catches the mail; the app's SMTP_* env points at it for e2e runs.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const PASSWORD = "correct horse battery";

interface MailpitSearch {
  messages: { ID: string }[];
}
interface MailpitMessage {
  Text: string;
}

/** Every confirmation token emailed to `email`, oldest first. */
export async function confirmationTokensFor(
  request: APIRequestContext,
  email: string,
  expectedCount = 1,
): Promise<string[]> {
  let tokens: string[] = [];

  await expect
    .poll(
      async () => {
        const search = await request.get(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const found = ((await search.json()) as MailpitSearch).messages;
        const bodies = await Promise.all(
          found.map(async ({ ID }) => {
            const message = await request.get(`${MAILPIT_URL}/api/v1/message/${ID}`);
            return ((await message.json()) as MailpitMessage).Text;
          }),
        );
        tokens = bodies
          .map((text) => /\/confirm\?token=([0-9a-f-]{36}\.[A-Za-z0-9_-]+)/.exec(text)?.[1])
          .filter((token): token is string => token !== undefined)
          .reverse(); // Mailpit lists newest first
        return tokens.length;
      },
      {
        message: `waiting for ${String(expectedCount)} confirmation email(s) to ${email} in Mailpit`,
        timeout: 15_000,
      },
    )
    .toBeGreaterThanOrEqual(expectedCount);

  return tokens;
}

export async function latestConfirmationToken(
  request: APIRequestContext,
  email: string,
  expectedCount = 1,
): Promise<string> {
  const tokens = await confirmationTokensFor(request, email, expectedCount);
  const latest = tokens[tokens.length - 1];
  if (!latest) throw new Error(`no confirmation token found for ${email}`);
  return latest;
}

export function uniqueEmail(prefix: string, label = ""): string {
  const suffix = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}${label ? `-${label}` : ""}-${suffix}@example.test`;
}

/** Fills and submits the real registration form; stops at the "check your email" screen. */
export async function submitRegistration(
  page: Page,
  { email, displayName }: { email: string; displayName: string },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Anzeigename").fill(displayName);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(
    page.getByRole("heading", { name: "Bestätigungslink wurde versendet" }),
  ).toBeVisible();
}

/** Opens the emailed link and presses the confirm button; ends on /dashboard. */
export async function confirmInBrowser(page: Page, token: string): Promise<void> {
  await page.goto(`/confirm?token=${token}`);
  await page.getByRole("button", { name: "Konto bestätigen" }).click();
  await page.waitForURL("**/dashboard");
}

/** Register and confirm through the UI. Returns the address used. */
export async function registerAndConfirm(
  page: Page,
  { prefix, label, displayName }: { prefix: string; label: string; displayName: string },
): Promise<string> {
  const email = uniqueEmail(prefix, label);
  await submitRegistration(page, { email, displayName });
  await confirmInBrowser(page, await latestConfirmationToken(page.request, email));
  return email;
}

/** Register and confirm over the API. Returns the session cookie and ids. */
export async function registerAndConfirmViaApi(
  request: APIRequestContext,
  email: string,
  displayName = "E2E Test",
): Promise<{ cookie: string; workspaceId: string }> {
  const register = await request.post("/api/trpc/auth.register", {
    data: { email, password: PASSWORD, displayName },
  });
  expect(register.ok(), await register.text()).toBe(true);
  // Feature 002: registering must NOT sign anyone in.
  expect(register.headers()["set-cookie"] ?? "").not.toContain("session=");

  const token = await latestConfirmationToken(request, email);
  const confirm = await request.post("/api/trpc/auth.confirm", { data: { token } });
  expect(confirm.ok(), await confirm.text()).toBe(true);

  const cookie = (confirm.headers()["set-cookie"] ?? "").split(";")[0] ?? "";
  if (!cookie.includes("session=")) {
    throw new Error("auth.confirm set no session cookie");
  }
  const body = (await confirm.json()) as { result: { data: { workspaceId: string } } };
  return { cookie, workspaceId: body.result.data.workspaceId };
}
