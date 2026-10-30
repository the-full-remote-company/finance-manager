import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";

/**
 * FR-004, FR-005, FR-006: correct credentials issue a session; a wrong
 * password and an unknown user return an identical generic `AUTH_FAILED`,
 * with no timing branch that distinguishes them (ADR 0003, Story 1
 * scenario 4).
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
  await ownerDb.execute(sql`truncate table "audit_events"`);
  await ownerDb.execute(sql`delete from "auth_attempts"`);
});

function caller(db: Database = appDb) {
  const setSessionCookie = vi.fn();
  const ctx: Context = { db, sessionToken: null, ip: "203.0.113.7", setSessionCookie };
  return { caller: appRouter.createCaller(ctx), setSessionCookie };
}

/**
 * Registers and, by default, confirms the account (feature 002): the
 * scenarios in this file are about credentials, so the account must be in its
 * post-confirmation state. The unconfirmed path is covered by
 * `sign-in-unconfirmed.test.ts` (T034).
 */
async function registerUser(email: string, password: string, displayName = "Person") {
  const { caller: c } = caller();
  const result = await c.auth.register({ email, password, displayName });
  await ownerDb.execute(
    sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${result.userId}`,
  );
  return result;
}

async function auditEventCount(type: string): Promise<number> {
  const result = await ownerDb.execute<{ count: string }>(
    sql`select count(*)::text as count from "audit_events" where "type" = ${type}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

describe("auth.signIn", () => {
  it("issues a session for correct credentials", async () => {
    await registerUser("person@example.test", "correct horse battery");

    const { caller: c, setSessionCookie } = caller();
    const result = await c.auth.signIn({
      email: "person@example.test",
      password: "correct horse battery",
    });

    expect(result.workspaceId).toBeTruthy();
    expect(setSessionCookie).toHaveBeenCalledTimes(1);

    // Exactly one row: registration no longer creates a session (feature
    // 002, FR-001), so this sign-in's is the only one.
    const sessionCount = await ownerDb.execute<{ count: string }>(
      sql`select count(*)::text as count from "sessions" where "workspace_id" = ${result.workspaceId}`,
    );
    expect(sessionCount.rows[0]?.count).toBe("1");
  });

  it("records sign_in_succeeded on success", async () => {
    await registerUser("person@example.test", "correct horse battery");
    const { caller: c } = caller();

    await c.auth.signIn({ email: "person@example.test", password: "correct horse battery" });

    expect(await auditEventCount("sign_in_succeeded")).toBe(1);
  });

  it("is case-insensitive on the email", async () => {
    await registerUser("person@example.test", "correct horse battery");
    const { caller: c } = caller();

    const result = await c.auth.signIn({
      email: "Person@Example.Test",
      password: "correct horse battery",
    });
    expect(typeof result.workspaceId).toBe("string");
  });

  it("refuses a wrong password with AUTH_FAILED", async () => {
    await registerUser("person@example.test", "correct horse battery");
    const { caller: c } = caller();

    await expect(
      c.auth.signIn({ email: "person@example.test", password: "wrong password entirely" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", cause: { appCode: "AUTH_FAILED" } });
  });

  it("refuses an unknown address with the identical AUTH_FAILED", async () => {
    const { caller: c } = caller();

    const unknownError = await c.auth
      .signIn({ email: "nobody@example.test", password: "whatever it might be" })
      .catch((error: unknown) => error);
    const wrongPasswordError = await (async () => {
      await registerUser("known@example.test", "correct horse battery");
      const { caller: c2 } = caller();
      return c2.auth
        .signIn({ email: "known@example.test", password: "wrong password entirely" })
        .catch((error: unknown) => error);
    })();

    expect((unknownError as { code: string }).code).toBe(
      (wrongPasswordError as { code: string }).code,
    );
    expect((unknownError as { message: string }).message).toBe(
      (wrongPasswordError as { message: string }).message,
    );
    expect((unknownError as { cause: unknown }).cause).toEqual(
      (wrongPasswordError as { cause: unknown }).cause,
    );
  });

  it("records sign_in_failed for both an unknown address and a wrong password, with no workspace", async () => {
    await registerUser("person@example.test", "correct horse battery");
    const { caller: c } = caller();

    await c.auth
      .signIn({ email: "nobody@example.test", password: "whatever" })
      .catch(() => undefined);
    await c.auth
      .signIn({ email: "person@example.test", password: "wrong password entirely" })
      .catch(() => undefined);

    expect(await auditEventCount("sign_in_failed")).toBe(2);

    const rows = await ownerDb.execute<{ workspace_id: string | null }>(
      sql`select "workspace_id" from "audit_events" where "type" = 'sign_in_failed'`,
    );
    for (const row of rows.rows) {
      expect(row.workspace_id).toBeNull();
    }
  });

  it("does not set a session cookie on failure", async () => {
    await registerUser("person@example.test", "correct horse battery");
    const { caller: c, setSessionCookie } = caller();

    await c.auth
      .signIn({ email: "person@example.test", password: "wrong password entirely" })
      .catch(() => undefined);

    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});
