import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";

/**
 * FR-001, FR-002: registration creates exactly one workspace with the
 * registrant as its only member; a duplicate email is rejected without
 * disclosing that the account exists (ADR 0003).
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
  await ownerDb.execute(sql`delete from "auth_attempts"`);
});

function caller(db: Database = appDb) {
  const setSessionCookie = vi.fn();
  const clearSessionCookie = vi.fn();
  const ctx: Context = {
    db,
    sessionToken: null,
    ip: "203.0.113.7",
    setSessionCookie,
    clearSessionCookie,
  };
  return { caller: appRouter.createCaller(ctx), setSessionCookie, clearSessionCookie };
}

async function countUsersByEmail(email: string): Promise<number> {
  const result = await ownerDb.execute<{ count: string }>(
    sql`select count(*)::text as count from "users" where lower("email") = ${email.toLowerCase()}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countWorkspaces(): Promise<number> {
  const result = await ownerDb.execute<{ count: string }>(
    sql`select count(*)::text as count from "workspaces"`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

describe("auth.register", () => {
  it("creates exactly one workspace with the registrant as its only member", async () => {
    const { caller: c, setSessionCookie } = caller();

    const result = await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    expect(result.userId).toBeTruthy();
    expect(result.workspaceId).toBeTruthy();
    expect(await countWorkspaces()).toBe(1);
    expect(await countUsersByEmail("person@example.test")).toBe(1);

    const members = await ownerDb.execute<{ count: string }>(
      sql`select count(*)::text as count from "users" where "workspace_id" = ${result.workspaceId}`,
    );
    expect(members.rows[0]?.count).toBe("1");

    // A session is issued on success.
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("normalises email case: registering twice with different casing is one collision", async () => {
    const { caller: c } = caller();

    await c.auth.register({
      email: "Person@Example.Test",
      password: "correct horse battery",
      displayName: "Person",
    });

    const { caller: c2, setSessionCookie: secondCookie } = caller();
    const second = await c2.auth.register({
      email: "person@example.test",
      password: "another password entirely",
      displayName: "Impersonator",
    });

    // Same shape as success, per ADR 0003 — but no second account exists and
    // no session was issued for the collision.
    expect(second.userId).toBeTruthy();
    expect(second.workspaceId).toBeTruthy();
    expect(await countWorkspaces()).toBe(1);
    expect(await countUsersByEmail("person@example.test")).toBe(1);
    expect(secondCookie).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email without disclosing that the account exists", async () => {
    const { caller: c } = caller();
    await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    const { caller: c2, setSessionCookie } = caller();
    const response = await c2.auth.register({
      email: "person@example.test",
      password: "a completely different phrase",
      displayName: "Someone Else",
    });

    // Same response shape as success (ADR 0003): no error, no distinguishing
    // field. The only observable difference is that no new account exists
    // and no session was granted for this call.
    expect(response).toHaveProperty("userId");
    expect(response).toHaveProperty("workspaceId");
    expect(await countWorkspaces()).toBe(1);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("does not create an orphaned workspace when the user insert collides", async () => {
    const { caller: c } = caller();
    await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    const { caller: c2 } = caller();
    await c2.auth.register({
      email: "person@example.test",
      password: "a completely different phrase",
      displayName: "Someone Else",
    });

    // The failed attempt's workspace insert must have rolled back with it.
    expect(await countWorkspaces()).toBe(1);
  });

  it("rejects a password shorter than 12 characters", async () => {
    // `errorFormatter` enriches the wire shape with `data.appCode` at the
    // transport boundary (packages/api/tests/errors.test.ts); `createCaller`
    // calls the resolver directly and bypasses it, so what a direct caller
    // sees is the raw ZodError tRPC's own input parsing throws. Both are
    // asserted: the transport code here, `errorFormatter`'s enrichment there.
    const { caller: c } = caller();
    await expect(
      c.auth.register({ email: "short@example.test", password: "short", displayName: "Short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(await countUsersByEmail("short@example.test")).toBe(0);
  });

  it("rejects a malformed email", async () => {
    const { caller: c } = caller();
    await expect(
      c.auth.register({
        email: "not-an-email",
        password: "correct horse battery",
        displayName: "Nobody",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never stores the plaintext password", async () => {
    const { caller: c } = caller();
    const result = await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    const row = await ownerDb.execute<{ password_hash: string }>(
      sql`select "password_hash" from "users" where "id" = ${result.userId}`,
    );
    expect(row.rows[0]?.password_hash).not.toBe("correct horse battery");
    expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });
});
