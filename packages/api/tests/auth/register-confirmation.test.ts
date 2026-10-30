import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  caller,
  closePools,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  scalar,
  sentEmails,
  sha256Hex,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}));

/**
 * T014 — feature 002, FR-001, FR-002, FR-004, FR-010, FR-011.
 * Registration creates an unconfirmed account and no session, issues exactly
 * one hashed token, and emails the link. A duplicate registration is
 * indistinguishable in shape from a genuine one, creates nothing, and sends
 * no email.
 */
afterAll(closePools);
beforeEach(resetAuthTables);

describe("auth.register — confirmation (T014)", () => {
  it("creates an unconfirmed account and sets no session cookie", async () => {
    const { caller: c, setSessionCookie } = caller();

    const { userId, workspaceId } = await c.auth.register({
      email: "alice@example.test",
      password: PASSWORD,
      displayName: "Alice",
    });

    expect(await scalar(sql`select "confirmed"::text from "users" where "id" = ${userId}`)).toBe(
      "false",
    );
    expect(
      await scalar(sql`select "confirmed_at" is null from "users" where "id" = ${userId}`),
    ).toBe(true);
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(
      await scalar(
        sql`select count(*)::text from "sessions" where "workspace_id" = ${workspaceId}`,
      ),
    ).toBe("0");
  });

  it("issues exactly one unexpired token, stored only as a hash of the emailed secret", async () => {
    const { userId, token } = await registerUnconfirmed("bob@example.test");
    const raw = token.split(".")[1] ?? "";

    expect(raw.length).toBeGreaterThanOrEqual(21); // 128 bits, base64url

    const rows = await ownerDb.execute<{ token_hash: string; live: boolean }>(
      sql`select "token_hash", ("expires_at" > now() and "superseded_at" is null) as live
          from "confirmation_tokens" where "user_id" = ${userId}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.live).toBe(true);
    expect(rows.rows[0]?.token_hash).toBe(sha256Hex(raw));
    // The raw secret itself is never persisted anywhere in the row.
    expect(JSON.stringify(rows.rows)).not.toContain(raw);
  });

  it("emails the address once, with a /confirm link carrying <workspaceId>.<token>", async () => {
    const { workspaceId } = await registerUnconfirmed("carol@example.test");

    const emails = sentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("carol@example.test");
    expect(new URL(emails[0]?.link ?? "").pathname).toBe("/confirm");
    expect(emails[0]?.token.startsWith(`${workspaceId}.`)).toBe(true);
  });

  describe.each([
    ["an unconfirmed", false],
    ["a confirmed", true],
  ])("registering %s address again (FR-011)", (_label, confirmed) => {
    async function setUp() {
      const first = await registerUnconfirmed("dave@example.test");
      if (confirmed) {
        await ownerDb.execute(
          sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${first.userId}`,
        );
      }
      return first;
    }

    it("returns the same response shape as a genuine registration", async () => {
      const genuine = await (async () => {
        const { caller: c } = caller();
        return c.auth.register({
          email: "genuine@example.test",
          password: PASSWORD,
          displayName: "Genuine",
        });
      })();
      await setUp();

      const { caller: c } = caller();
      const duplicate = await c.auth.register({
        email: "dave@example.test",
        password: PASSWORD,
        displayName: "Impostor",
      });

      expect(Object.keys(duplicate).sort()).toEqual(Object.keys(genuine).sort());
      expect(typeof duplicate.userId).toBe("string");
      expect(typeof duplicate.workspaceId).toBe("string");
    });

    it("creates no account, no token, no session, and sends no email", async () => {
      const first = await setUp();
      const emailsBefore = sentEmails().length;
      const tokensBefore = await scalar(sql`select count(*)::text from "confirmation_tokens"`);

      const { caller: c, setSessionCookie } = caller();
      const duplicate = await c.auth.register({
        email: "dave@example.test",
        password: PASSWORD,
        displayName: "Impostor",
      });

      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(sentEmails()).toHaveLength(emailsBefore);
      expect(await scalar(sql`select count(*)::text from "confirmation_tokens"`)).toBe(
        tokensBefore,
      );
      expect(
        await scalar(
          sql`select count(*)::text from "users" where lower("email") = 'dave@example.test'`,
        ),
      ).toBe("1");
      // The response ids are fabricated: they point at nothing.
      expect(duplicate.userId).not.toBe(first.userId);
      expect(
        await scalar(sql`select count(*)::text from "users" where "id" = ${duplicate.userId}`),
      ).toBe("0");
    });
  });

  it("is throttled by the existing auth_attempts mechanism (FR-010)", async () => {
    const { caller: c } = caller();
    const attempt = () =>
      c.auth.register({
        email: "throttled@example.test",
        password: PASSWORD,
        displayName: "T",
      });

    let rejection: unknown;
    for (let i = 0; i < 50 && rejection === undefined; i += 1) {
      rejection = await attempt().then(
        () => undefined,
        (error: unknown) => error,
      );
    }

    expect(rejection).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      cause: { appCode: "RATE_LIMITED" },
    });
    expect(await scalar(sql`select count(*)::text from "auth_attempts"`)).not.toBe("0");
  });
});
