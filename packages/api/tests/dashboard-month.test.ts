import { addMonths, formatMonth, parseMonth } from "@finance/core";
import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { registerConfirmedWorkspace } from "./support/session.js";

/**
 * `dashboard.month` and `dashboard.horizon`, per contracts/procedures.md.
 * `MONTH_OUT_OF_HORIZON` outside the rolling window; `retrievedAt` present on
 * every response; presentation is a request parameter, never server state
 * (T089).
 */
const appPool = createPool({
  connectionString: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/finance",
});
const ownerPool = createPool({
  connectionString:
    process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance",
});
const appDb = createDatabase(appPool);
const ownerDb = createDatabase(ownerPool);

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

beforeEach(async () => {
  await ownerDb.execute(sql`truncate table "workspaces" cascade`);
});

let registrations = 0;

async function registerWorkspace(
  db: Database = appDb,
): Promise<{ token: string; workspaceId: string }> {
  registrations += 1;
  return registerConfirmedWorkspace(db, ownerDb, `tester-${String(registrations)}@example.test`);
}

function callerWithToken(token: string, db: Database = appDb) {
  const ctx: Context = { db, sessionToken: token, ip: null };
  return appRouter.createCaller(ctx);
}

async function fixture() {
  const { token } = await registerWorkspace();
  const c = callerWithToken(token);
  const account = await c.accounts.create({ name: "Girokonto" });
  const expenseCategory = await c.categories.create({ name: "Wohnen", direction: "expense" });
  const incomeCategory = await c.categories.create({ name: "Gehalt", direction: "income" });
  return {
    c,
    accountId: account.id,
    expenseCategoryId: expenseCategory.id,
    incomeCategoryId: incomeCategory.id,
  };
}

describe("dashboard.horizon", () => {
  it("returns the rolling 24-month window around the current month", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const horizon = await c.dashboard.horizon();

    const current = parseMonth(horizon.currentMonth);
    expect(parseMonth(horizon.firstMonth)).toBe(addMonths(current, -12));
    expect(parseMonth(horizon.lastMonth)).toBe(addMonths(current, 11));
  });
});

describe("dashboard.month", () => {
  it("rejects a month outside the rolling horizon: MONTH_OUT_OF_HORIZON", async () => {
    const { c } = await fixture();
    const horizon = await c.dashboard.horizon();
    const pastHorizon = formatMonth(parseMonth(horizon.firstMonth) - 1);

    await expect(
      c.dashboard.month({ month: pastHorizon, presentation: "cash" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { appCode: "MONTH_OUT_OF_HORIZON" },
    });
  });

  it("accepts the first and last month of the horizon", async () => {
    const { c } = await fixture();
    const horizon = await c.dashboard.horizon();

    await expect(
      c.dashboard.month({ month: horizon.firstMonth, presentation: "cash" }),
    ).resolves.toBeDefined();
    await expect(
      c.dashboard.month({ month: horizon.lastMonth, presentation: "cash" }),
    ).resolves.toBeDefined();
  });

  it("stamps every response with retrievedAt", async () => {
    const { c } = await fixture();
    const horizon = await c.dashboard.horizon();

    const before = Date.now();
    const result = await c.dashboard.month({ month: horizon.currentMonth, presentation: "cash" });
    const after = Date.now();

    const retrievedAt = Date.parse(result.retrievedAt);
    expect(retrievedAt).toBeGreaterThanOrEqual(before);
    expect(retrievedAt).toBeLessThanOrEqual(after);
  });

  it("treats presentation as a request parameter, never server state: two requests in a row may differ", async () => {
    const { c } = await fixture();
    const horizon = await c.dashboard.horizon();

    const cash = await c.dashboard.month({ month: horizon.currentMonth, presentation: "cash" });
    expect(cash.presentation).toBe("cash");

    const smoothed = await c.dashboard.month({
      month: horizon.currentMonth,
      presentation: "smoothed",
    });
    expect(smoothed.presentation).toBe("smoothed");

    // A second "cash" request is identical to the first: the smoothed request
    // in between did not mutate anything server-side.
    const cashAgain = await c.dashboard.month({
      month: horizon.currentMonth,
      presentation: "cash",
    });
    expect(cashAgain.presentation).toBe("cash");
    expect(cashAgain.expenseTotal).toEqual(cash.expenseTotal);
  });

  it("totals a month's income, expense categories and remaining (FR-031)", async () => {
    const { c, accountId, expenseCategoryId, incomeCategoryId } = await fixture();
    const horizon = await c.dashboard.horizon();
    const startDate = `${horizon.currentMonth}-01`;

    await c.commitments.create({
      name: "Gehalt",
      direction: "income",
      kind: "expense",
      categoryId: incomeCategoryId,
      sourceAccountId: accountId,
      sharePercent: 100,
      rhythm: "monthly",
      startDate,
      initialAmount: { minor: "300000", currency: "EUR" },
    });
    await c.commitments.create({
      name: "Miete",
      direction: "expense",
      kind: "expense",
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
      sharePercent: 100,
      rhythm: "monthly",
      startDate,
      initialAmount: { minor: "95000", currency: "EUR" },
    });

    const result = await c.dashboard.month({ month: horizon.currentMonth, presentation: "cash" });

    expect(result.income.total).toEqual({ minor: "300000", currency: "EUR" });
    expect(result.expenseTotal).toEqual({ minor: "95000", currency: "EUR" });
    expect(result.remaining).toEqual({ minor: "205000", currency: "EUR" });
    const housing = result.expenseCategories.find((cat) => cat.categoryId === expenseCategoryId);
    expect(housing?.total).toEqual({ minor: "95000", currency: "EUR" });
    expect(housing?.percentOfIncome).toEqual({ numerator: "95000", denominator: "300000" });
  });

  it("another workspace's commitments never appear (Article I)", async () => {
    const { c } = await fixture();
    const other = await fixture();
    const horizon = await c.dashboard.horizon();
    const startDate = `${horizon.currentMonth}-01`;

    await other.c.commitments.create({
      name: "Fremde Miete",
      direction: "expense",
      kind: "expense",
      categoryId: other.expenseCategoryId,
      sourceAccountId: other.accountId,
      sharePercent: 100,
      rhythm: "monthly",
      startDate,
      initialAmount: { minor: "50000", currency: "EUR" },
    });

    const result = await c.dashboard.month({ month: horizon.currentMonth, presentation: "cash" });
    expect(result.expenseCategories).toHaveLength(0);
    expect(result.expenseTotal).toEqual({ minor: "0", currency: "EUR" });
  });
});
