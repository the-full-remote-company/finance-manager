import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { appRouter } from "../src/router.js";

/**
 * FR-007, FR-008, FR-009a: create, rename, reorder, delete for accounts and
 * categories; NAME_TAKEN on a duplicate; rename permitted while referenced;
 * DIRECTION_IMMUTABLE on an attempted category direction change (T072).
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

describe("accounts", () => {
  it("creates, lists, renames and reorders", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const girokonto = await c.accounts.create({ name: "Girokonto" });
    const sparkonto = await c.accounts.create({ name: "Sparkonto", note: "Notgroschen" });

    const list = await c.accounts.list({});
    expect(list.map((a) => a.name)).toEqual(["Girokonto", "Sparkonto"]);
    expect(list.find((a) => a.id === sparkonto.id)?.note).toBe("Notgroschen");

    await c.accounts.rename({ id: girokonto.id, name: "Hauptkonto" });
    const renamed = await c.accounts.list({});
    expect(renamed.find((a) => a.id === girokonto.id)?.name).toBe("Hauptkonto");

    await c.accounts.reorder({ ids: [sparkonto.id, girokonto.id] });
    const reordered = await c.accounts.list({});
    expect(reordered.map((a) => a.id)).toEqual([sparkonto.id, girokonto.id]);
  });

  it("rejects a duplicate name with NAME_TAKEN", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    await c.accounts.create({ name: "Girokonto" });
    await expect(c.accounts.create({ name: "Girokonto" })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "NAME_TAKEN" },
    });
  });

  it("permits a rename to a name that collides with nothing, even while referenced (FR-009a)", async () => {
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

    await expect(c.accounts.rename({ id: account.id, name: "Hauptkonto" })).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects rename/reorder of an account in another workspace", async () => {
    const alpha = await registerWorkspace();
    const beta = await registerWorkspace();
    const account = await callerWithToken(alpha.token).accounts.create({ name: "Girokonto" });

    await expect(
      callerWithToken(beta.token).accounts.rename({ id: account.id, name: "Gestohlen" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      callerWithToken(beta.token).accounts.reorder({ ids: [account.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("categories", () => {
  it("creates, lists, renames and reorders, carrying direction", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const wohnen = await c.categories.create({ name: "Wohnen", direction: "expense" });
    const gehalt = await c.categories.create({ name: "Gehalt", direction: "income" });

    const list = await c.categories.list({});
    expect(list.map((cat) => ({ name: cat.name, direction: cat.direction }))).toEqual([
      { name: "Wohnen", direction: "expense" },
      { name: "Gehalt", direction: "income" },
    ]);

    await c.categories.rename({ id: wohnen.id, name: "Miete & Wohnen" });
    const renamed = await c.categories.list({});
    expect(renamed.find((cat) => cat.id === wohnen.id)?.name).toBe("Miete & Wohnen");

    await c.categories.reorder({ ids: [gehalt.id, wohnen.id] });
    const reordered = await c.categories.list({});
    expect(reordered.map((cat) => cat.id)).toEqual([gehalt.id, wohnen.id]);
  });

  it("rejects a duplicate name with NAME_TAKEN", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    await c.categories.create({ name: "Wohnen", direction: "expense" });
    await expect(
      c.categories.create({ name: "Wohnen", direction: "income" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "NAME_TAKEN" },
    });
  });

  it("refuses an attempted direction change with DIRECTION_IMMUTABLE", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const wohnen = await c.categories.create({ name: "Wohnen", direction: "expense" });

    await expect(
      c.categories.rename({ id: wohnen.id, name: "Wohnen", direction: "income" }),
    ).rejects.toMatchObject({ code: "CONFLICT", cause: { appCode: "DIRECTION_IMMUTABLE" } });

    // Direction is unchanged after the refusal.
    const list = await c.categories.list({});
    expect(list.find((cat) => cat.id === wohnen.id)?.direction).toBe("expense");
  });

  it("permits a rename that repeats the same direction", async () => {
    const { token } = await registerWorkspace();
    const c = callerWithToken(token);

    const wohnen = await c.categories.create({ name: "Wohnen", direction: "expense" });
    await expect(
      c.categories.rename({ id: wohnen.id, name: "Wohnen & Nebenkosten", direction: "expense" }),
    ).resolves.toEqual({ ok: true });
  });
});
