import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  caller,
  closePools,
  lastEmail,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  scalar,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}));

/**
 * T015 — feature 002, FR-005, FR-006, FR-007, FR-008; edge cases T041, T043.
 * `auth.confirm` marks the account confirmed, consumes the token, and is the
 * only place a session is created for a new account. Every refusal is the same
 * `TOKEN_INVALID`, creates no session, and leaves the account unconfirmed.
 */
afterAll(closePools);
beforeEach(resetAuthTables);

const TOKEN_INVALID = { code: "BAD_REQUEST", cause: { appCode: "TOKEN_INVALID" } };

async function expectRefused(token: string, userId?: string) {
  const { caller: c, setSessionCookie } = caller();
  await expect(c.auth.confirm({ token })).rejects.toMatchObject(TOKEN_INVALID);
  expect(setSessionCookie).not.toHaveBeenCalled();
  if (userId) {
    expect(await scalar(sql`select "confirmed"::text from "users" where "id" = ${userId}`)).toBe(
      "false",
    );
  }
}

describe("auth.confirm — success (T015)", () => {
  it("confirms the account, creates one session, and sets the cookie", async () => {
    const { userId, workspaceId, token } = await registerUnconfirmed("alice@example.test");
    const { caller: c, setSessionCookie } = caller();

    const result = await c.auth.confirm({ token });

    expect(result).toEqual({ userId, workspaceId });
    expect(await scalar(sql`select "confirmed"::text from "users" where "id" = ${userId}`)).toBe(
      "true",
    );
    expect(
      await scalar(sql`select "confirmed_at" is not null from "users" where "id" = ${userId}`),
    ).toBe(true);
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
    expect(
      await scalar(sql`select count(*)::text from "sessions" where "user_id" = ${userId}`),
    ).toBe("1");
  });

  it("issues a session that actually resolves to the confirmed user", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    const { caller: c, setSessionCookie } = caller();
    await c.auth.confirm({ token });

    const cookieToken = setSessionCookie.mock.calls[0]?.[0] as string;
    const { appRouter } = await import("../../src/router.js");
    const { appDb } = await import("../support/confirmation.js");
    const session = await appRouter
      .createCaller({ db: appDb, sessionToken: cookieToken, ip: null })
      .auth.session({});

    expect(session?.userId).toBe(userId);
  });

  it("consumes the token: a second use is refused and creates no second session (spec scenario 4)", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    await caller().caller.auth.confirm({ token });

    const { caller: c, setSessionCookie } = caller();
    await expect(c.auth.confirm({ token })).rejects.toMatchObject(TOKEN_INVALID);

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(
      await scalar(sql`select count(*)::text from "sessions" where "user_id" = ${userId}`),
    ).toBe("1");
    expect(await scalar(sql`select count(*)::text from "confirmation_tokens"`)).toBe("0");
  });

  it("works from a different caller than the one that registered (T040)", async () => {
    const { token } = await registerUnconfirmed("alice@example.test");
    // A fresh caller with a different IP and no cookie, as a second browser would be.
    const { caller: elsewhere, setSessionCookie } = caller(undefined, "198.51.100.9");

    await elsewhere.auth.confirm({ token });

    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });
});

describe("auth.confirm — refusals, all TOKEN_INVALID (FR-007)", () => {
  it("an unknown token of the right shape", async () => {
    const { userId, workspaceId } = await registerUnconfirmed("alice@example.test");
    await expectRefused(`${workspaceId}.AAAAAAAAAAAAAAAAAAAAAA`, userId);
  });

  it("a malformed token (no workspace prefix, not a UUID, empty raw part)", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    const raw = token.split(".")[1] ?? "";

    await expectRefused(raw, userId);
    await expectRefused(`not-a-uuid.${raw}`, userId);
    await expectRefused(`${token.split(".")[0] ?? ""}.`, userId);
  });

  it("an expired token (FR-003)", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    await ownerDb.execute(
      sql`update "confirmation_tokens" set "expires_at" = now() - interval '1 second'
          where "user_id" = ${userId}`,
    );

    await expectRefused(token, userId);
  });

  it("a superseded token, while the newer one works (FR-008, T041)", async () => {
    const { userId, token: first } = await registerUnconfirmed("alice@example.test");
    await caller().caller.auth.resendConfirmation({ email: "alice@example.test" });
    const second = lastEmail().token;

    expect(second).not.toBe(first);
    await expectRefused(first, userId);

    const { caller: c, setSessionCookie } = caller();
    await c.auth.confirm({ token: second });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("another workspace's prefix on a real secret: row-level security hides the token (Article I)", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    const other = await registerUnconfirmed("mallory@example.test");
    const raw = token.split(".")[1] ?? "";

    await expectRefused(`${other.workspaceId}.${raw}`, userId);
    // Alice's own link is still good: the failed attempt consumed nothing.
    const { caller: c } = caller();
    await expect(c.auth.confirm({ token })).resolves.toMatchObject({ userId });
  });

  it("a link for an account that has since been deleted (T043)", async () => {
    const { workspaceId, token } = await registerUnconfirmed("alice@example.test");
    await ownerDb.execute(sql`delete from "workspaces" where "id" = ${workspaceId}`);

    await expectRefused(token);
  });
});

describe("auth.confirm — ALREADY_CONFIRMED", () => {
  it("refuses a still-live token for an account confirmed by other means, and creates no session", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${userId}`,
    );
    const { caller: c, setSessionCookie } = caller();

    await expect(c.auth.confirm({ token })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { appCode: "ALREADY_CONFIRMED" },
    });

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(
      await scalar(sql`select count(*)::text from "sessions" where "user_id" = ${userId}`),
    ).toBe("0");
  });
});

describe("auth.confirm — what it must not do", () => {
  it("does not let an unconfirmed account sign in before confirmation, and does after", async () => {
    const { token } = await registerUnconfirmed("alice@example.test");
    const { caller: c1 } = caller();
    await expect(
      c1.auth.signIn({ email: "alice@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ cause: { appCode: "ACCOUNT_NOT_CONFIRMED" } });

    await caller().caller.auth.confirm({ token });

    const { caller: c2, setSessionCookie } = caller();
    await c2.auth.signIn({ email: "alice@example.test", password: PASSWORD });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });
});
