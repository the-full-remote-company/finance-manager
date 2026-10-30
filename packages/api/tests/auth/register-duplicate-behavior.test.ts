import { hashPassword, sendConfirmationEmail } from "@finance/auth";
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
  sentEmails,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@finance/auth")>();
  return {
    ...original,
    hashPassword: vi.fn(original.hashPassword),
    sendConfirmationEmail: vi.fn(() => Promise.resolve()),
  };
});

/**
 * T030 — feature 002, FR-011, ADR 0003.
 * A duplicate registration, confirmed or not, must leave no trace that a
 * caller could use or a mailbox owner could receive: no email (not even a
 * "someone tried to register your address" notice), no audit row, no
 * workspace, and the same password-hashing and throttling work as a genuine
 * one.
 */
afterAll(closePools);
beforeEach(async () => {
  await resetAuthTables();
  vi.mocked(hashPassword).mockClear();
});

const EMAIL = "dave@example.test";

async function setUpExisting(confirmed: boolean) {
  const first = await registerUnconfirmed(EMAIL);
  if (confirmed) {
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${first.userId}`,
    );
  }
  vi.mocked(sendConfirmationEmail).mockClear();
  vi.mocked(hashPassword).mockClear();
  return first;
}

const auditCount = () => scalar(sql`select count(*)::text from "audit_events"`);
const workspaceCount = () => scalar(sql`select count(*)::text from "workspaces"`);

describe.each([
  ["an unconfirmed", false],
  ["a confirmed", true],
])("registering %s address again (T030)", (_label, confirmed) => {
  it("sends no email at all, not even a notice to the owner", async () => {
    await setUpExisting(confirmed);

    await caller().caller.auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Impostor",
    });

    expect(sentEmails()).toHaveLength(0);
  });

  it("writes no audit event", async () => {
    await setUpExisting(confirmed);
    const before = await auditCount();

    await caller().caller.auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Impostor",
    });

    expect(await auditCount()).toBe(before);
  });

  it("creates no workspace, user or token, and the first account is unchanged", async () => {
    const first = await setUpExisting(confirmed);
    const workspacesBefore = await workspaceCount();
    const tokensBefore = await scalar(sql`select count(*)::text from "confirmation_tokens"`);

    await caller().caller.auth.register({
      email: EMAIL,
      password: "a completely different phrase",
      displayName: "Impostor",
    });

    expect(await workspaceCount()).toBe(workspacesBefore);
    expect(await scalar(sql`select count(*)::text from "confirmation_tokens"`)).toBe(tokensBefore);
    expect(await scalar(sql`select "display_name" from "users" where "id" = ${first.userId}`)).toBe(
      "Person",
    );
    expect(
      await scalar(
        sql`select "password_hash" is not null from "users" where "id" = ${first.userId}`,
      ),
    ).toBe(true);
  });

  it("does the same password-hashing work as a genuine registration (FR-011)", async () => {
    await setUpExisting(confirmed);

    await caller().caller.auth.register({
      email: EMAIL,
      password: "the impostor's password",
      displayName: "Impostor",
    });

    expect(vi.mocked(hashPassword)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hashPassword).mock.calls[0]?.[0]).toBe("the impostor's password");
  });
});

describe("a duplicate is throttled exactly like a genuine registration (T030)", () => {
  const budgetSpent = () =>
    scalar(sql`select coalesce(sum("attempts"), 0)::text from "auth_attempts"`);

  it("a genuine registration and a duplicate each spend exactly one unit of throttle budget", async () => {
    // Genuine: a new address from a fresh source.
    await resetAuthTables();
    await caller(undefined, "203.0.113.10").caller.auth.register({
      email: "brand-new@example.test",
      password: PASSWORD,
      displayName: "Genuine",
    });
    const genuine = await budgetSpent();

    // Duplicate: an existing address, budget cleared so only this call counts.
    await setUpExisting(false);
    await ownerDb.execute(sql`delete from "auth_attempts"`);
    await caller(undefined, "203.0.113.11").caller.auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Duplicate",
    });
    const duplicate = await budgetSpent();

    expect(genuine).toBe("1");
    expect(duplicate).toBe(genuine);
  });

  it("repeated duplicates are refused with RATE_LIMITED once the window is exhausted", async () => {
    await setUpExisting(false);
    await ownerDb.execute(sql`delete from "auth_attempts"`);
    const { caller: c } = caller(undefined, "203.0.113.12");

    let firstRejected: number | undefined;
    for (
      let call = 1;
      call <= AUTH_RATE_LIMIT.maxAttempts + 1 && firstRejected === undefined;
      call += 1
    ) {
      const rejection = await c.auth
        .register({ email: EMAIL, password: PASSWORD, displayName: "Dup" })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      if (rejection !== undefined) {
        expect(rejection).toMatchObject({ cause: { appCode: "RATE_LIMITED" } });
        firstRejected = call;
      }
    }

    expect(firstRejected).toBe(AUTH_RATE_LIMIT.maxAttempts + 1);
  });
});
