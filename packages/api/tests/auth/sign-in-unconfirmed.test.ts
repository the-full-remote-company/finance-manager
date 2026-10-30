import { verifyPassword } from "@finance/auth";
import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_RATE_LIMIT } from "../../src/middleware/rate-limit.js";
import {
  PASSWORD,
  caller,
  closePools,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  scalar,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@finance/auth")>();
  return {
    ...original,
    verifyPassword: vi.fn(original.verifyPassword),
    sendConfirmationEmail: vi.fn(() => Promise.resolve()),
  };
});

/**
 * T034 — feature 002, FR-020, ADR 0003, User Story 4.
 * The password is checked first. With the right one, an unconfirmed account
 * gets a distinct "not confirmed" answer and no session; with a wrong one it
 * gets exactly the generic failure an unknown address gets, so the distinct
 * answer is only ever shown to someone who already proved they hold the
 * password. Both are audited as sign-in failures that name no workspace.
 */
afterAll(closePools);
beforeEach(async () => {
  await resetAuthTables();
  vi.mocked(verifyPassword).mockClear();
});

const EMAIL = "alice@example.test";

async function failureOf(email: string, password: string): Promise<unknown> {
  return caller()
    .caller.auth.signIn({ email, password })
    .then(
      () => {
        throw new Error("sign-in unexpectedly succeeded");
      },
      (error: unknown) => error,
    );
}

describe("auth.signIn — an unconfirmed account, correct password (T034)", () => {
  it("answers ACCOUNT_NOT_CONFIRMED carrying only the address the caller typed", async () => {
    await registerUnconfirmed(EMAIL);

    const error = await failureOf("  ALICE@Example.TEST ", PASSWORD);

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      cause: { appCode: "ACCOUNT_NOT_CONFIRMED", details: { email: EMAIL } },
    });
    // Nothing but the address: no ids, no timestamps, no hint of tokens.
    const details = (error as { cause: { details: Record<string, unknown> } }).cause.details;
    expect(Object.keys(details)).toEqual(["email"]);
  });

  it("creates no session and sets no cookie", async () => {
    await registerUnconfirmed(EMAIL);
    const { caller: c, setSessionCookie } = caller();

    await c.auth.signIn({ email: EMAIL, password: PASSWORD }).catch(() => undefined);

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(await scalar(sql`select count(*)::text from "sessions"`)).toBe("0");
  });

  it("records sign_in_failed naming no workspace and no user, and no sign_in_succeeded", async () => {
    await registerUnconfirmed(EMAIL);

    await failureOf(EMAIL, PASSWORD);

    const rows = await ownerDb.execute<{ workspace_id: string | null; user_id: string | null }>(
      sql`select "workspace_id", "user_id" from "audit_events" where "type" = 'sign_in_failed'`,
    );
    expect(rows.rows).toEqual([{ workspace_id: null, user_id: null }]);
    expect(
      await scalar(
        sql`select count(*)::text from "audit_events" where "type" = 'sign_in_succeeded'`,
      ),
    ).toBe("0");
  });

  it("does not become sign-in-able by asking for a resend", async () => {
    await registerUnconfirmed(EMAIL);
    await caller().caller.auth.resendConfirmation({ email: EMAIL });

    expect(await failureOf(EMAIL, PASSWORD)).toMatchObject({
      cause: { appCode: "ACCOUNT_NOT_CONFIRMED" },
    });
  });
});

describe("auth.signIn — an unconfirmed account, wrong password (T034, enumeration)", () => {
  it("is AUTH_FAILED, never ACCOUNT_NOT_CONFIRMED", async () => {
    await registerUnconfirmed(EMAIL);

    expect(await failureOf(EMAIL, "wrong password entirely")).toMatchObject({
      code: "UNAUTHORIZED",
      cause: { appCode: "AUTH_FAILED" },
    });
  });

  it("is byte-identical to the failure for a confirmed account and for an unknown address", async () => {
    await registerUnconfirmed("unconfirmed@example.test");
    const confirmed = await registerUnconfirmed("confirmed@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${confirmed.userId}`,
    );

    const shapes = [];
    for (const email of [
      "unconfirmed@example.test",
      "confirmed@example.test",
      "unknown@example.test",
    ]) {
      const error = (await failureOf(email, "wrong password entirely")) as {
        code: string;
        message: string;
        cause: unknown;
      };
      shapes.push(JSON.stringify({ code: error.code, message: error.message, cause: error.cause }));
    }

    expect(shapes[1]).toBe(shapes[0]);
    expect(shapes[2]).toBe(shapes[0]);
  });

  it("verifies the password before it looks at confirmation, on every path", async () => {
    await registerUnconfirmed(EMAIL);

    await failureOf(EMAIL, "wrong password entirely");
    await failureOf(EMAIL, PASSWORD);
    await failureOf("unknown@example.test", PASSWORD);

    // Once per attempt, including the unknown address (ADR 0003: no short-circuit).
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(3);
  });

  it("records the same sign_in_failed event, naming no workspace, as for a wrong password anywhere", async () => {
    await registerUnconfirmed(EMAIL);

    await failureOf(EMAIL, "wrong password entirely");

    const rows = await ownerDb.execute<{ workspace_id: string | null; user_id: string | null }>(
      sql`select "workspace_id", "user_id" from "audit_events" where "type" = 'sign_in_failed'`,
    );
    expect(rows.rows).toEqual([{ workspace_id: null, user_id: null }]);
  });
});

describe("auth.signIn — throttling an unconfirmed account", () => {
  it("counts correct-password attempts too, so the distinct answer cannot be farmed", async () => {
    await registerUnconfirmed(EMAIL);
    const { caller: c } = caller(undefined, "203.0.113.77");

    let rejection: unknown;
    for (
      let call = 1;
      call <= AUTH_RATE_LIMIT.maxAttempts + 1 && rejection === undefined;
      call += 1
    ) {
      const error = (await c.auth.signIn({ email: EMAIL, password: PASSWORD }).then(
        () => undefined,
        (e: unknown) => e,
      )) as { cause?: { appCode?: string } } | undefined;
      if (error?.cause?.appCode === "RATE_LIMITED") rejection = error;
    }

    expect(rejection).toMatchObject({ cause: { appCode: "RATE_LIMITED" } });
  });
});
