import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../support/a11y.js";

/**
 * Story 1 scenario 2, FR-003: "user A requests user B's identifier through
 * every route and receives the absent-record response every time" (T063).
 *
 * This talks to the tRPC endpoint directly through Playwright's
 * `APIRequestContext` rather than driving the browser: the property under
 * test is a server response shape, identical to a genuinely-missing record
 * (Article I), and no screen in this feature yet renders a single commitment
 * by id for a UI-level probe to click through. The axe scan — the other half
 * of T063 — runs against the real screens separately, below.
 */

interface Registered {
  cookie: string;
  workspaceId: string;
  accountId: string;
  categoryId: string;
  commitmentId: string;
}

async function registerAndSetUp(request: APIRequestContext, email: string): Promise<Registered> {
  const register = await request.post("/api/trpc/auth.register", {
    data: { email, password: "correct horse battery", displayName: "Isolation Test" },
  });
  expect(register.ok(), await register.text()).toBe(true);
  const registerBody = (await register.json()) as { result: { data: { workspaceId: string } } };
  const setCookie = register.headers()["set-cookie"] ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  if (!cookie.startsWith("__Host-session=")) {
    throw new Error(`no session cookie in response: ${setCookie}`);
  }

  const account = await request.post("/api/trpc/accounts.create", {
    headers: { cookie },
    data: { name: `Konto ${email}` },
  });
  expect(account.ok(), await account.text()).toBe(true);
  const accountBody = (await account.json()) as { result: { data: { id: string } } };

  const category = await request.post("/api/trpc/categories.create", {
    headers: { cookie },
    data: { name: `Kategorie ${email}`, direction: "expense" },
  });
  expect(category.ok(), await category.text()).toBe(true);
  const categoryBody = (await category.json()) as { result: { data: { id: string } } };

  const commitment = await request.post("/api/trpc/commitments.create", {
    headers: { cookie },
    data: {
      name: `Verpflichtung ${email}`,
      direction: "expense",
      kind: "expense",
      categoryId: categoryBody.result.data.id,
      sourceAccountId: accountBody.result.data.id,
      rhythm: "monthly",
      startDate: "2026-01-01",
      initialAmount: { minor: "1000", currency: "EUR" },
    },
  });
  expect(commitment.ok(), await commitment.text()).toBe(true);
  const commitmentBody = (await commitment.json()) as { result: { data: { id: string } } };

  return {
    cookie,
    workspaceId: registerBody.result.data.workspaceId,
    accountId: accountBody.result.data.id,
    categoryId: categoryBody.result.data.id,
    commitmentId: commitmentBody.result.data.id,
  };
}

function isAbsentRecordResponse(status: number, body: unknown): boolean {
  if (status < 400) return false;
  const appCode = (body as { error?: { data?: { appCode?: unknown } } }).error?.data?.appCode;
  return appCode === "NOT_FOUND";
}

test.describe("US1: cross-workspace isolation (FR-003, Story 1 scenario 2)", () => {
  test("user A receives the absent-record response for every one of user B's identifiers, on every route", async ({
    request,
  }) => {
    const unique = String(Date.now());
    const alice = await registerAndSetUp(request, `alice-${unique}@example.test`);
    const bob = await registerAndSetUp(request, `bob-${unique}@example.test`);

    const probes: { name: string; response: () => Promise<{ status: number; body: unknown }> }[] = [
      {
        name: "accounts.rename",
        response: async () => {
          const r = await request.post("/api/trpc/accounts.rename", {
            headers: { cookie: alice.cookie },
            data: { id: bob.accountId, name: "gestohlen" },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "accounts.delete",
        response: async () => {
          const r = await request.post("/api/trpc/accounts.delete", {
            headers: { cookie: alice.cookie },
            data: { id: bob.accountId },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "categories.rename",
        response: async () => {
          const r = await request.post("/api/trpc/categories.rename", {
            headers: { cookie: alice.cookie },
            data: { id: bob.categoryId, name: "gestohlen" },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "categories.delete",
        response: async () => {
          const r = await request.post("/api/trpc/categories.delete", {
            headers: { cookie: alice.cookie },
            data: { id: bob.categoryId },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "commitments.get",
        response: async () => {
          const r = await request.get(
            `/api/trpc/commitments.get?input=${encodeURIComponent(JSON.stringify({ id: bob.commitmentId }))}`,
            { headers: { cookie: alice.cookie } },
          );
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "commitments.update",
        response: async () => {
          const r = await request.post("/api/trpc/commitments.update", {
            headers: { cookie: alice.cookie },
            data: { id: bob.commitmentId, name: "gestohlen" },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
      {
        name: "commitments.delete",
        response: async () => {
          const r = await request.post("/api/trpc/commitments.delete", {
            headers: { cookie: alice.cookie },
            data: { id: bob.commitmentId },
          });
          return { status: r.status(), body: await r.json() };
        },
      },
    ];

    for (const probe of probes) {
      const { status, body } = await probe.response();
      expect(isAbsentRecordResponse(status, body), `${probe.name}: ${JSON.stringify(body)}`).toBe(
        true,
      );
    }

    // And a genuinely-absent record, on the same route, produces a
    // byte-identical shape (Article I: non-existence and non-entitlement are
    // indistinguishable on the wire).
    const genuinelyMissing = await request.get(
      `/api/trpc/commitments.get?input=${encodeURIComponent(JSON.stringify({ id: crypto.randomUUID() }))}`,
      { headers: { cookie: alice.cookie } },
    );
    const foreignRecord = await request.get(
      `/api/trpc/commitments.get?input=${encodeURIComponent(JSON.stringify({ id: bob.commitmentId }))}`,
      { headers: { cookie: alice.cookie } },
    );
    expect(await genuinelyMissing.json()).toEqual(await foreignRecord.json());
    expect(genuinelyMissing.status()).toBe(foreignRecord.status());

    // Bob's own data survived every attempt.
    const bobsCommitment = await request.get(
      `/api/trpc/commitments.get?input=${encodeURIComponent(JSON.stringify({ id: bob.commitmentId }))}`,
      { headers: { cookie: bob.cookie } },
    );
    expect(bobsCommitment.ok()).toBe(true);
  });
});

test.describe("US1: accessibility of the auth screens", () => {
  test("register has no serious or critical accessibility violation", async ({ page }) => {
    await page.goto("/register");
    await expectNoSeriousA11yViolations(page, "/register");
  });

  test("sign-in has no serious or critical accessibility violation", async ({ page }) => {
    await page.goto("/sign-in");
    await expectNoSeriousA11yViolations(page, "/sign-in");
  });
});
