import { sql } from "@finance/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { PASSWORD, caller, closePools, resetAuthTables, scalar } from "../support/confirmation.js";

/**
 * T042 — feature 002, FR-017. Deliberately NOT mocking the mailer: the real
 * one, pointed at a port nothing listens on, so the failure is a real
 * `ECONNREFUSED` from a real socket.
 *
 * Registration must succeed and answer as it always does; the account is
 * created and can be confirmed later; the failure reaches an operator's log as
 * machine codes only, never the recipient or the link (which carries the
 * secret); and a later resend works independently of the earlier failure.
 */
const EMAIL = "alice@example.test";

let errorLog: MockInstance<(...args: unknown[]) => void>;

beforeAll(() => {
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", "1"); // closed: connection refused at once
  vi.stubEnv("SMTP_FROM", "noreply@example.test");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_PASS", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closePools();
});

beforeEach(async () => {
  await resetAuthTables();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
});

const loggedErrors = (): string => JSON.stringify(errorLog.mock.calls);

describe("registration while the mail provider is unreachable (T042)", () => {
  it("still creates the account and answers with the usual shape and no session", async () => {
    const { caller: c, setSessionCookie } = caller();

    const result = await c.auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Alice",
    });

    expect(Object.keys(result)).toEqual(["userId", "workspaceId"]);
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(
      await scalar(sql`select "confirmed"::text from "users" where "id" = ${result.userId}`),
    ).toBe("false");
    expect(
      await scalar(
        sql`select count(*)::text from "confirmation_tokens"
            where "user_id" = ${result.userId} and "superseded_at" is null`,
      ),
    ).toBe("1");
  });

  it("logs the failure as machine codes only, never the recipient, link or secret (Article VIII)", async () => {
    await caller().caller.auth.register({ email: EMAIL, password: PASSWORD, displayName: "Alice" });

    await vi.waitFor(() => {
      expect(errorLog).toHaveBeenCalled();
    });

    const logged = loggedErrors();
    expect(logged).toContain("[email] Failed to send confirmation");
    // A real machine code from the real socket error (nodemailer names a refused
    // connection ESOCKET), not the "unknown" fallback.
    expect(logged).toMatch(/"code":"E[A-Z]+"/);
    expect(logged).not.toContain('"code":"unknown"');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain("alice");
    expect(logged).not.toContain("/confirm");
    expect(logged).not.toContain("token");
  });

  it("a resend afterwards still answers ok and issues a fresh token that confirms the account", async () => {
    const { userId } = await caller().caller.auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Alice",
    });

    await expect(caller().caller.auth.resendConfirmation({ email: EMAIL })).resolves.toEqual({
      ok: true,
    });

    expect(
      await scalar(
        sql`select count(*)::text from "confirmation_tokens"
            where "user_id" = ${userId} and "superseded_at" is null and "expires_at" > now()`,
      ),
    ).toBe("1");
    expect(
      await scalar(
        sql`select count(*)::text from "confirmation_tokens" where "user_id" = ${userId}`,
      ),
    ).toBe("2");
  });
});
