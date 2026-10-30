import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { registerConfirmedWorkspace } from "./support/session.js";

/**
 * `commitments.update` cannot change an amount (that is `amounts.*`);
 * `commitments.delete` cascades to amounts and overrides and removes the
 * commitment from every month in the horizon, including past ones (Story 2
 * scenario 5). (T075)
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
  const otherAccount = await c.accounts.create({ name: "Sparkonto" });
  const category = await c.categories.create({ name: "Wohnen", direction: "expense" });
  const otherCategory = await c.categories.create({ name: "Freizeit", direction: "expense" });
  const commitment = await c.commitments.create({
    name: "Miete",
    direction: "expense",
    kind: "expense",
    categoryId: category.id,
    sourceAccountId: account.id,
    rhythm: "monthly",
    startDate: "2026-01-01",
    initialAmount: { minor: "95000", currency: "EUR" },
  });
  return { c, account, otherAccount, category, otherCategory, commitment };
}

describe("commitments.update", () => {
  it("updates a field, leaving the amount untouched", async () => {
    const { c, commitment } = await fixture();

    await c.commitments.update({ id: commitment.id, name: "Miete Neu" });

    const updated = await c.commitments.get({ id: commitment.id });
    expect(updated.name).toBe("Miete Neu");
    expect(updated.currentAmount).toEqual({ minor: "95000", currency: "EUR" });
    expect(updated.amounts).toHaveLength(1);
  });

  it("ignores an initialAmount smuggled into the input: amounts are amounts.*'s business", async () => {
    // `update`'s input type is `create`'s input with `initialAmount`
    // specifically excluded (contracts/procedures.md), so a well-typed
    // caller cannot even construct this call — this simulates an
    // OpenAPI/REST caller unconstrained by the TypeScript type.
    const { c, commitment } = await fixture();

    await (
      c.commitments.update as unknown as (input: Record<string, unknown>) => Promise<{ ok: true }>
    )({ id: commitment.id, initialAmount: { minor: "1", currency: "EUR" } });

    const after = await c.commitments.get({ id: commitment.id });
    expect(after.currentAmount).toEqual({ minor: "95000", currency: "EUR" });
    expect(after.amounts).toHaveLength(1);
  });

  it("moving category re-validates direction agreement", async () => {
    const { c, commitment, otherCategory } = await fixture();
    const incomeCategory = await c.categories.create({ name: "Gehalt", direction: "income" });

    await expect(
      c.commitments.update({ id: commitment.id, categoryId: incomeCategory.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { appCode: "DIRECTION_MISMATCH", details: { categoryDirection: "income" } },
    });

    // A same-direction category is accepted.
    await expect(
      c.commitments.update({ id: commitment.id, categoryId: otherCategory.id }),
    ).resolves.toEqual({ ok: true });
  });

  it("re-validates the shape rules against the merged (not just the patch) state", async () => {
    const { c, commitment } = await fixture();

    // Switching rhythm without supplying an anchor is still ANCHOR_REQUIRED,
    // even though this call's own input carries no anchorMonth field either.
    await expect(
      c.commitments.update({ id: commitment.id, rhythm: "quarterly" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appCode: "ANCHOR_REQUIRED" } });
  });

  it("rejects an unknown commitment with NOT_FOUND", async () => {
    const { c } = await fixture();
    await expect(
      c.commitments.update({ id: crypto.randomUUID(), name: "Ghost" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects updating a commitment in another workspace with NOT_FOUND", async () => {
    const alpha = await fixture();
    const beta = await fixture();

    await expect(
      beta.c.commitments.update({ id: alpha.commitment.id, name: "Gestohlen" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("commitments.delete", () => {
  it("cascades to its amounts, per data-model.md", async () => {
    const { c, commitment } = await fixture();

    await c.commitments.delete({ id: commitment.id });

    const amountRows = await ownerDb.execute<{ count: string }>(
      sql`select count(*)::text as count from "commitment_amounts" where "commitment_id" = ${commitment.id}`,
    );
    expect(amountRows.rows[0]?.count).toBe("0");
  });

  it("removes the commitment from the list entirely, including past months (Story 2 scenario 5)", async () => {
    const { c, commitment } = await fixture();

    await c.commitments.delete({ id: commitment.id });

    const list = await c.commitments.list({});
    expect(list.find((entry) => entry.id === commitment.id)).toBeUndefined();
    await expect(c.commitments.get({ id: commitment.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an unknown commitment with NOT_FOUND", async () => {
    const { c } = await fixture();
    await expect(c.commitments.delete({ id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects deleting a commitment in another workspace with NOT_FOUND", async () => {
    const alpha = await fixture();
    const beta = await fixture();

    await expect(beta.c.commitments.delete({ id: alpha.commitment.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
