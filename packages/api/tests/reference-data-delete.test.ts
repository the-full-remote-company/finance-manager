import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { registerConfirmedWorkspace } from "./support/session.js";

/**
 * FR-009 and its edge case: deleting a referenced category or account returns
 * `STILL_REFERENCED` with the count, and both reference kinds — source and
 * transfer destination — count toward an account's total. Deleting the last
 * *unreferenced* category or account is permitted (T073).
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

describe("accounts.delete", () => {
  it("deletes an unreferenced account", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const account = await c.accounts.create({ name: "Girokonto" });
    await expect(c.accounts.delete({ id: account.id })).resolves.toEqual({ ok: true });

    const list = await c.accounts.list({});
    expect(list).toHaveLength(0);
  });

  it("refuses deletion while referenced as a source account", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const account = await c.accounts.create({ name: "Girokonto" });
    const category = await c.categories.create({ name: "Wohnen", direction: "expense" });
    await c.commitments.create({
      name: "Miete",
      direction: "expense",
      kind: "expense",
      categoryId: category.id,
      sourceAccountId: account.id,
      rhythm: "monthly",
      startDate: "2026-01-01",
      initialAmount: { minor: "95000", currency: "EUR" },
    });

    await expect(c.accounts.delete({ id: account.id })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "STILL_REFERENCED", details: { referenceCount: 1 } },
    });
  });

  it("counts both source and transfer-destination references toward the total (edge case)", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const source = await c.accounts.create({ name: "Girokonto" });
    const destination = await c.accounts.create({ name: "Sparkonto" });
    const category = await c.categories.create({ name: "Sparen", direction: "expense" });

    await c.commitments.create({
      name: "Zum Sparkonto",
      direction: "expense",
      kind: "reserve",
      categoryId: category.id,
      sourceAccountId: source.id,
      transferAccountId: destination.id,
      rhythm: "monthly",
      startDate: "2026-01-01",
      initialAmount: { minor: "10000", currency: "EUR" },
    });

    const sourceCount = await c.accounts.referenceCount({ id: source.id });
    expect(sourceCount).toEqual({ asSource: 1, asTransferDestination: 0, total: 1 });

    const destinationCount = await c.accounts.referenceCount({ id: destination.id });
    expect(destinationCount).toEqual({ asSource: 0, asTransferDestination: 1, total: 1 });

    await expect(c.accounts.delete({ id: destination.id })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "STILL_REFERENCED", details: { referenceCount: 1 } },
    });
  });

  it("returns NOT_FOUND for an unknown account", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);
    await expect(c.accounts.delete({ id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("categories.delete", () => {
  it("deletes an unreferenced category", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const category = await c.categories.create({ name: "Wohnen", direction: "expense" });
    await expect(c.categories.delete({ id: category.id })).resolves.toEqual({ ok: true });
  });

  it("refuses deletion while referenced by a commitment", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const account = await c.accounts.create({ name: "Girokonto" });
    const category = await c.categories.create({ name: "Wohnen", direction: "expense" });
    await c.commitments.create({
      name: "Miete",
      direction: "expense",
      kind: "expense",
      categoryId: category.id,
      sourceAccountId: account.id,
      rhythm: "monthly",
      startDate: "2026-01-01",
      initialAmount: { minor: "95000", currency: "EUR" },
    });

    await expect(c.categories.delete({ id: category.id })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "STILL_REFERENCED", details: { referenceCount: 1 } },
    });

    const total = await c.categories.referenceCount({ id: category.id });
    expect(total).toEqual({ total: 1 });
  });
});
