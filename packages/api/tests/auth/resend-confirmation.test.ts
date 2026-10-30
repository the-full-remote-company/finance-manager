import { sendConfirmationEmail } from "@finance/auth";
import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_RATE_LIMIT } from "../../src/middleware/rate-limit.js";
import {
  caller,
  closePools,
  lastEmail,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  scalar,
  sentEmails,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}));

/**
 * T023 — feature 002, FR-008, FR-009, FR-010, FR-015, FR-017; spec scenario 5.
 * A resend for an unconfirmed account supersedes every earlier token and
 * emails a new link. For a confirmed or unknown address it answers the same
 * and does nothing at all: no mail, no token, no audit row. It is throttled by
 * the existing `auth_attempts` mechanism, unknown addresses included, so the
 * throttle is not an oracle either.
 */
afterAll(closePools);
beforeEach(resetAuthTables);

const EMAIL = "alice@example.test";

async function liveTokens(userId: string): Promise<string | undefined> {
  return scalar(
    sql`select count(*)::text from "confirmation_tokens"
        where "user_id" = ${userId} and "superseded_at" is null and "expires_at" > now()`,
  );
}

const countTokens = () => scalar(sql`select count(*)::text from "confirmation_tokens"`);
const countResentEvents = () =>
  scalar(sql`select count(*)::text from "audit_events" where "type" = 'confirmation_resent'`);

describe("auth.resendConfirmation — an unconfirmed account (FR-008)", () => {
  it("answers { ok: true } and emails the address a new, different link", async () => {
    const { token: first } = await registerUnconfirmed(EMAIL);

    const result = await caller().caller.auth.resendConfirmation({ email: EMAIL });

    expect(result).toEqual({ ok: true });
    const emails = sentEmails();
    expect(emails).toHaveLength(2);
    expect(emails[1]?.to).toBe(EMAIL);
    expect(emails[1]?.token).not.toBe(first);
    expect(new URL(emails[1]?.link ?? "").pathname).toBe("/confirm");
  });

  it("leaves exactly one live token and marks the earlier one superseded", async () => {
    const { userId } = await registerUnconfirmed(EMAIL);

    await caller().caller.auth.resendConfirmation({ email: EMAIL });

    expect(await liveTokens(userId)).toBe("1");
    expect(
      await scalar(
        sql`select count(*)::text from "confirmation_tokens"
            where "user_id" = ${userId} and "superseded_at" is not null`,
      ),
    ).toBe("1");
  });

  it("supersedes every earlier token however many resends there have been", async () => {
    const { userId, token: first } = await registerUnconfirmed(EMAIL);

    await caller().caller.auth.resendConfirmation({ email: EMAIL });
    const second = lastEmail().token;
    await caller().caller.auth.resendConfirmation({ email: EMAIL });
    const third = lastEmail().token;

    expect(new Set([first, second, third]).size).toBe(3);
    expect(await liveTokens(userId)).toBe("1");

    for (const stale of [first, second]) {
      await expect(caller().caller.auth.confirm({ token: stale })).rejects.toMatchObject({
        cause: { appCode: "TOKEN_INVALID" },
      });
    }
    await expect(caller().caller.auth.confirm({ token: third })).resolves.toMatchObject({
      userId,
    });
  });

  it("the previous link stops working and the new one confirms the account", async () => {
    const { userId, token: first } = await registerUnconfirmed(EMAIL);
    await caller().caller.auth.resendConfirmation({ email: EMAIL });
    const second = lastEmail().token;

    await expect(caller().caller.auth.confirm({ token: first })).rejects.toMatchObject({
      cause: { appCode: "TOKEN_INVALID" },
    });
    await expect(caller().caller.auth.confirm({ token: second })).resolves.toMatchObject({
      userId,
    });
  });

  it("recovers from an expired link: a resend after expiry yields a working one (spec scenario 5)", async () => {
    const { userId, token: expired } = await registerUnconfirmed(EMAIL);
    await ownerDb.execute(
      sql`update "confirmation_tokens" set "expires_at" = now() - interval '1 second'
          where "user_id" = ${userId}`,
    );
    await expect(caller().caller.auth.confirm({ token: expired })).rejects.toMatchObject({
      cause: { appCode: "TOKEN_INVALID" },
    });

    await caller().caller.auth.resendConfirmation({ email: EMAIL });

    await expect(caller().caller.auth.confirm({ token: lastEmail().token })).resolves.toMatchObject(
      { userId },
    );
  });

  it("finds the account whatever the case or surrounding whitespace of the address", async () => {
    await registerUnconfirmed(EMAIL);

    await caller().caller.auth.resendConfirmation({ email: "  ALICE@Example.TEST " });

    expect(sentEmails()).toHaveLength(2);
    expect(lastEmail().to).toBe(EMAIL);
  });

  it("records confirmation_resent once, attributed to the workspace and user, with a hashed ip", async () => {
    const { userId, workspaceId } = await registerUnconfirmed(EMAIL);

    await caller().caller.auth.resendConfirmation({ email: EMAIL });

    const rows = await ownerDb.execute<{
      workspace_id: string | null;
      user_id: string | null;
      ip_hash: Buffer | null;
    }>(
      sql`select "workspace_id", "user_id", "ip_hash" from "audit_events"
          where "type" = 'confirmation_resent'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.workspace_id).toBe(workspaceId);
    expect(rows.rows[0]?.user_id).toBe(userId);
    expect(rows.rows[0]?.ip_hash?.length).toBe(16);
  });

  it("touches no other account's tokens (Article I)", async () => {
    const alice = await registerUnconfirmed(EMAIL);
    const bob = await registerUnconfirmed("bob@example.test");

    await caller().caller.auth.resendConfirmation({ email: EMAIL });

    expect(await liveTokens(bob.userId)).toBe("1");
    await expect(caller().caller.auth.confirm({ token: bob.token })).resolves.toMatchObject({
      userId: bob.userId,
    });
    expect(await liveTokens(alice.userId)).toBe("1");
  });
});

describe("auth.resendConfirmation — nothing to resend (FR-009)", () => {
  async function confirmedAccount() {
    const { userId } = await registerUnconfirmed(EMAIL);
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${userId}`,
    );
    await ownerDb.execute(sql`delete from "confirmation_tokens" where "user_id" = ${userId}`);
    vi.mocked(sendConfirmationEmail).mockClear();
    return userId;
  }

  async function confirmedAddress(): Promise<string> {
    await confirmedAccount();
    return EMAIL;
  }

  it.each([
    ["a confirmed address", confirmedAddress],
    ["an unknown address", () => Promise.resolve("nobody@example.test")],
  ])("%s: answers { ok: true } and writes, sends and records nothing", async (_label, setUp) => {
    const email = await setUp();
    const tokensBefore = await countTokens();

    const result = await caller().caller.auth.resendConfirmation({ email });

    expect(result).toEqual({ ok: true });
    expect(sentEmails()).toHaveLength(0);
    expect(await countTokens()).toBe(tokensBefore);
    expect(await countResentEvents()).toBe("0");
  });

  it("the response is identical for unconfirmed, confirmed and unknown addresses", async () => {
    await registerUnconfirmed("unconfirmed@example.test");
    const confirmed = await registerUnconfirmed("confirmed@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${confirmed.userId}`,
    );

    const responses = [];
    for (const email of [
      "unconfirmed@example.test",
      "confirmed@example.test",
      "unknown@example.test",
    ]) {
      responses.push(await caller().caller.auth.resendConfirmation({ email }));
    }

    expect(responses[1]).toEqual(responses[0]);
    expect(responses[2]).toEqual(responses[0]);
    expect(JSON.stringify(responses[2])).toBe(JSON.stringify(responses[0]));
  });
});

describe("auth.resendConfirmation — mail failure (FR-017)", () => {
  it("answers the same and still issues the token when the mailer rejects", async () => {
    const { userId } = await registerUnconfirmed(EMAIL);
    vi.mocked(sendConfirmationEmail).mockRejectedValueOnce(new Error("550 provider is down"));

    const result = await caller().caller.auth.resendConfirmation({ email: EMAIL });

    expect(result).toEqual({ ok: true });
    expect(await liveTokens(userId)).toBe("1");
  });
});

describe("auth.resendConfirmation — throttling (FR-010)", () => {
  async function callsUntilThrottled(email: string): Promise<{
    firstRejected: number | undefined;
    rejection: unknown;
  }> {
    const { caller: c } = caller();
    for (let call = 1; call <= AUTH_RATE_LIMIT.maxAttempts + 1; call += 1) {
      const rejection = await c.auth.resendConfirmation({ email }).then(
        () => undefined,
        (error: unknown) => error,
      );
      if (rejection !== undefined) return { firstRejected: call, rejection };
    }
    return { firstRejected: undefined, rejection: undefined };
  }

  it("refuses with RATE_LIMITED once the window is exhausted, and the refused call does nothing", async () => {
    const { userId } = await registerUnconfirmed(EMAIL);

    const { firstRejected, rejection } = await callsUntilThrottled(EMAIL);

    expect(firstRejected).toBeDefined();
    expect(firstRejected).toBeLessThanOrEqual(AUTH_RATE_LIMIT.maxAttempts);
    expect(rejection).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      cause: { appCode: "RATE_LIMITED" },
    });

    // The refused call neither issued a token nor sent mail: one email for the
    // registration plus one per allowed resend.
    const allowedResends = (firstRejected ?? 1) - 1;
    expect(sentEmails()).toHaveLength(1 + allowedResends);
    expect(await liveTokens(userId)).toBe("1");
  });

  it("throttles an unknown address in the same way, so the throttle reveals nothing", async () => {
    const { firstRejected, rejection } = await callsUntilThrottled("nobody@example.test");

    expect(firstRejected).toBeDefined();
    expect(rejection).toMatchObject({ cause: { appCode: "RATE_LIMITED" } });
  });

  it("does not throttle a different address from the same ip", async () => {
    await registerUnconfirmed(EMAIL);
    await callsUntilThrottled(EMAIL);

    await expect(
      caller().caller.auth.resendConfirmation({ email: "someone-else@example.test" }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("auth.resendConfirmation — input", () => {
  it("rejects a malformed address before doing anything", async () => {
    await expect(
      caller().caller.auth.resendConfirmation({ email: "not-an-email" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sentEmails()).toHaveLength(0);
  });
});
