import { hashPassword } from "@finance/auth";
import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../../src/router.js";
import {
  PASSWORD,
  appDb,
  caller,
  closePools,
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
 * T033 — feature 002, FR-020, User Story 4.
 * Once confirmed, an account signs in, resolves a session and signs out
 * exactly as it did before this feature: same outcomes, same audit events.
 * That includes accounts that existed before the feature, which the
 * migration's `confirmed default true` makes confirmed (FR-019).
 */
afterAll(closePools);
beforeEach(resetAuthTables);

const EMAIL = "alice@example.test";

async function confirmedThroughTheRealFlow() {
  const { userId, workspaceId, token } = await registerUnconfirmed(EMAIL);
  await caller().caller.auth.confirm({ token });
  return { userId, workspaceId };
}

describe("auth.signIn — a confirmed account (T033)", () => {
  it("issues a session that resolves to the user, after the account was confirmed by link", async () => {
    const { userId, workspaceId } = await confirmedThroughTheRealFlow();
    const { caller: c, setSessionCookie } = caller();

    const result = await c.auth.signIn({ email: EMAIL, password: PASSWORD });

    expect(result).toEqual({ workspaceId });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
    const cookieToken = setSessionCookie.mock.calls[0]?.[0] as string;
    const session = await appRouter
      .createCaller({ db: appDb, sessionToken: cookieToken, ip: null })
      .auth.session({});
    expect(session?.userId).toBe(userId);
  });

  it("records sign_in_succeeded attributed to the workspace and user", async () => {
    const { userId, workspaceId } = await confirmedThroughTheRealFlow();

    await caller().caller.auth.signIn({ email: EMAIL, password: PASSWORD });

    const rows = await ownerDb.execute<{ workspace_id: string | null; user_id: string | null }>(
      sql`select "workspace_id", "user_id" from "audit_events" where "type" = 'sign_in_succeeded'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toEqual({ workspace_id: workspaceId, user_id: userId });
  });

  it("a wrong password is AUTH_FAILED, with no session and no cookie", async () => {
    await confirmedThroughTheRealFlow();
    const { caller: c, setSessionCookie } = caller();
    const sessionsBefore = await scalar(sql`select count(*)::text from "sessions"`);

    await expect(
      c.auth.signIn({ email: EMAIL, password: "wrong password entirely" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", cause: { appCode: "AUTH_FAILED" } });

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(await scalar(sql`select count(*)::text from "sessions"`)).toBe(sessionsBefore);
  });

  it("signs out and signs in again, each a fresh session", async () => {
    await confirmedThroughTheRealFlow();

    const first = caller();
    await first.caller.auth.signIn({ email: EMAIL, password: PASSWORD });
    const firstToken = first.setSessionCookie.mock.calls[0]?.[0] as string;

    const signedOut = appRouter.createCaller({
      db: appDb,
      sessionToken: firstToken,
      ip: null,
      clearSessionCookie: vi.fn(),
    });
    await signedOut.auth.signOut({});
    expect(
      await appRouter
        .createCaller({ db: appDb, sessionToken: firstToken, ip: null })
        .auth.session({}),
    ).toBeNull();

    const second = caller();
    await second.caller.auth.signIn({ email: EMAIL, password: PASSWORD });
    const secondToken = second.setSessionCookie.mock.calls[0]?.[0] as string;
    expect(secondToken).not.toBe(firstToken);
    expect(
      (
        await appRouter
          .createCaller({ db: appDb, sessionToken: secondToken, ip: null })
          .auth.session({})
      )?.displayName,
    ).toBe("Person");
  });

  it("an account that existed before the feature signs in without ever confirming (FR-019)", async () => {
    // Inserted the way a pre-feature account exists: no `confirmed` value, so the
    // column default that migration 0005 chose applies.
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    await ownerDb.execute(
      sql`insert into "workspaces" ("id", "name") values (${workspaceId}, 'Legacy')`,
    );
    await ownerDb.execute(
      sql`insert into "users" ("id", "workspace_id", "email", "display_name", "password_hash")
          values (${userId}, ${workspaceId}, 'legacy@example.test', 'Legacy', ${await hashPassword(PASSWORD)})`,
    );
    expect(await scalar(sql`select "confirmed"::text from "users" where "id" = ${userId}`)).toBe(
      "true",
    );

    const { caller: c, setSessionCookie } = caller();
    await expect(
      c.auth.signIn({ email: "legacy@example.test", password: PASSWORD }),
    ).resolves.toEqual({ workspaceId });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("resending a confirmation sends nothing to a confirmed account and does not disturb its sign-in", async () => {
    await confirmedThroughTheRealFlow();
    const mailsAfterRegistration = sentEmails().length;

    await caller().caller.auth.resendConfirmation({ email: EMAIL });
    expect(sentEmails()).toHaveLength(mailsAfterRegistration);

    const { caller: c, setSessionCookie } = caller();
    await c.auth.signIn({ email: EMAIL, password: PASSWORD });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });
});
