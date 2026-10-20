import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_RATE_LIMIT } from "../../src/middleware/rate-limit.js";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";

/**
 * FR-005, Story 1 scenario 4: repeated failed sign-in attempts cross the
 * threshold and return `RATE_LIMITED` with `retryAfterSeconds` — the same
 * throttle applies to registration.
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
  const ctx: Context = { db, sessionToken: null, ip: "203.0.113.7", setSessionCookie: vi.fn() };
  return appRouter.createCaller(ctx);
}

describe("auth throttling (FR-005)", () => {
  it("throttles repeated failed sign-in attempts with RATE_LIMITED and a retry hint", async () => {
    const c = caller();
    await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    for (let attempt = 0; attempt < AUTH_RATE_LIMIT.maxAttempts; attempt += 1) {
      await c.auth
        .signIn({ email: "person@example.test", password: "wrong password entirely" })
        .catch(() => undefined);
    }

    const error = await c.auth
      .signIn({ email: "person@example.test", password: "wrong password entirely" })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS", cause: { appCode: "RATE_LIMITED" } });
    const retryAfterSeconds = (error as { cause: { details: { retryAfterSeconds: number } } }).cause
      .details.retryAfterSeconds;
    expect(retryAfterSeconds).toBeGreaterThan(0);
  });

  it("throttles a burst of registration attempts for the same address", async () => {
    const c = caller();
    const email = "repeat@example.test";

    for (let attempt = 0; attempt < AUTH_RATE_LIMIT.maxAttempts; attempt += 1) {
      await c.auth
        .register({ email, password: "correct horse battery", displayName: "Person" })
        .catch(() => undefined);
    }

    await expect(
      c.auth.register({ email, password: "correct horse battery", displayName: "Person" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", cause: { appCode: "RATE_LIMITED" } });
  });

  it("does not throttle a different address after one is exhausted", async () => {
    const c = caller();
    await c.auth.register({
      email: "person@example.test",
      password: "correct horse battery",
      displayName: "Person",
    });

    for (let attempt = 0; attempt <= AUTH_RATE_LIMIT.maxAttempts; attempt += 1) {
      await c.auth
        .signIn({ email: "person@example.test", password: "wrong password entirely" })
        .catch(() => undefined);
    }

    const other = await c.auth.register({
      email: "someone-else@example.test",
      password: "correct horse battery",
      displayName: "Someone Else",
    });
    // Sign-in requires a confirmed account (feature 002).
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${other.userId}`,
    );

    const result = await c.auth.signIn({
      email: "someone-else@example.test",
      password: "correct horse battery",
    });
    expect(typeof result.workspaceId).toBe("string");
  });
});
