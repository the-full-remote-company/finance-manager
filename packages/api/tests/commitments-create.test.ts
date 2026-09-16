import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { appRouter } from "../src/router.js";

/**
 * FR-010–FR-020, contracts/procedures.md's `commitments.create` rule table.
 * (T074)
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
  let capturedToken: string | undefined;
  const ctx: Context = {
    db,
    sessionToken: null,
    ip: "203.0.113.7",
    setSessionCookie: (token) => {
      capturedToken = token;
    },
  };
  const result = await appRouter.createCaller(ctx).auth.register({
    email: `tester-${String(registrations)}@example.test`,
    password: "correct horse battery",
    displayName: "Tester",
  });
  if (!capturedToken) throw new Error("no session token captured");
  return { token: capturedToken, workspaceId: result.workspaceId };
}

function callerWithToken(token: string, db: Database = appDb) {
  const ctx: Context = { db, sessionToken: token, ip: null };
  return appRouter.createCaller(ctx);
}

interface Fixture {
  c: ReturnType<typeof callerWithToken>;
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
}

async function fixture(): Promise<Fixture> {
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

const baseInput = {
  name: "Miete",
  direction: "expense" as const,
  kind: "expense" as const,
  rhythm: "monthly" as const,
  startDate: "2026-01-01",
  initialAmount: { minor: "95000", currency: "EUR" },
};

describe("commitments.create", () => {
  it("creates a monthly commitment with its initial amount", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    const result = await c.commitments.create({
      ...baseInput,
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
    });

    const commitment = await c.commitments.get({ id: result.id });
    expect(commitment.name).toBe("Miete");
    expect(commitment.currentAmount).toEqual({ minor: "95000", currency: "EUR" });
    expect(commitment.amounts).toHaveLength(1);
    expect(commitment.amounts[0]?.amount).toEqual({ minor: "95000", currency: "EUR" });
  });

  it("accepts an amount of zero (a paused contract needs no deletion)", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    const result = await c.commitments.create({
      ...baseInput,
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
      initialAmount: { minor: "0", currency: "EUR" },
    });

    const commitment = await c.commitments.get({ id: result.id });
    expect(commitment.currentAmount).toEqual({ minor: "0", currency: "EUR" });
  });

  it("defaults sharePercent to 100 and accepts 0 through 100 inclusive", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    const withDefault = await c.commitments.create({
      ...baseInput,
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
    });
    expect((await c.commitments.get({ id: withDefault.id })).sharePercent).toBe(100);

    const withZero = await c.commitments.create({
      ...baseInput,
      name: "Miete (0%)",
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
      sharePercent: 0,
    });
    expect((await c.commitments.get({ id: withZero.id })).sharePercent).toBe(0);

    const withHundred = await c.commitments.create({
      ...baseInput,
      name: "Miete (100%)",
      categoryId: expenseCategoryId,
      sourceAccountId: accountId,
      sharePercent: 100,
    });
    expect((await c.commitments.get({ id: withHundred.id })).sharePercent).toBe(100);
  });

  it("rejects a non-monthly rhythm with no anchor month: ANCHOR_REQUIRED", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        categoryId: expenseCategoryId,
        sourceAccountId: accountId,
        rhythm: "quarterly",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appCode: "ANCHOR_REQUIRED" } });
  });

  it("accepts a non-monthly rhythm with an anchor month", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        categoryId: expenseCategoryId,
        sourceAccountId: accountId,
        rhythm: "quarterly",
        anchorMonth: "2026-01",
      }),
    ).resolves.toMatchObject({ id: expect.any(String) as string });
  });

  it("rejects a transfer destination equal to the source account: TRANSFER_EQUALS_SOURCE", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        categoryId: expenseCategoryId,
        sourceAccountId: accountId,
        transferAccountId: accountId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appCode: "TRANSFER_EQUALS_SOURCE" } });
  });

  it("rejects a contract end date before the start date: END_BEFORE_START", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        categoryId: expenseCategoryId,
        sourceAccountId: accountId,
        endDate: "2025-12-31",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appCode: "END_BEFORE_START" } });
  });

  it("accepts a contract end date equal to the start date", async () => {
    const { c, accountId, expenseCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        categoryId: expenseCategoryId,
        sourceAccountId: accountId,
        endDate: "2026-01-01",
      }),
    ).resolves.toMatchObject({ id: expect.any(String) as string });
  });

  it("rejects a direction that disagrees with the category's direction: DIRECTION_MISMATCH", async () => {
    const { c, accountId, incomeCategoryId } = await fixture();

    await expect(
      c.commitments.create({
        ...baseInput,
        direction: "expense",
        categoryId: incomeCategoryId,
        sourceAccountId: accountId,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { appCode: "DIRECTION_MISMATCH", details: { categoryDirection: "income" } },
    });
  });

  it("rejects a category belonging to another workspace: NOT_FOUND (FR-003)", async () => {
    const alpha = await fixture();
    const beta = await fixture();

    await expect(
      alpha.c.commitments.create({
        ...baseInput,
        categoryId: beta.expenseCategoryId,
        sourceAccountId: alpha.accountId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a source account belonging to another workspace: NOT_FOUND (FR-003)", async () => {
    const alpha = await fixture();
    const beta = await fixture();

    await expect(
      alpha.c.commitments.create({
        ...baseInput,
        categoryId: alpha.expenseCategoryId,
        sourceAccountId: beta.accountId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a transfer account belonging to another workspace: NOT_FOUND (FR-003)", async () => {
    const alpha = await fixture();
    const beta = await fixture();

    await expect(
      alpha.c.commitments.create({
        ...baseInput,
        categoryId: alpha.expenseCategoryId,
        sourceAccountId: alpha.accountId,
        transferAccountId: beta.accountId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
