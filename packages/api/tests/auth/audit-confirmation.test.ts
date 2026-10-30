import { sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caller,
  closePools,
  lastEmail,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  sha256Hex,
} from "../support/confirmation.js";

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
}));

/**
 * T016 — feature 002, FR-015, Article VIII.
 * A successful confirmation appends `account_confirmed` attributed to the
 * workspace and user; a refused one appends `confirmation_failed` attributed
 * to nobody (no identity was proven); a resend appends `confirmation_resent`.
 * No audit row ever carries an email address or any form of the token.
 */
afterAll(closePools);
beforeEach(resetAuthTables);

type AuditRow = {
  workspace_id: string | null;
  user_id: string | null;
  type: string;
  ip_hash: Buffer | null;
  detail: unknown;
};

async function auditRows(type?: string): Promise<AuditRow[]> {
  const result = await ownerDb.execute<AuditRow>(
    type
      ? sql`select "workspace_id", "user_id", "type", "ip_hash", "detail" from "audit_events"
            where "type" = ${type} order by "occurred_at"`
      : sql`select "workspace_id", "user_id", "type", "ip_hash", "detail" from "audit_events"
            order by "occurred_at"`,
  );
  return result.rows;
}

describe("audit — confirmation (T016)", () => {
  it("appends account_confirmed with workspace, user and a hashed ip on success", async () => {
    const { userId, workspaceId, token } = await registerUnconfirmed("alice@example.test");

    await caller().caller.auth.confirm({ token });

    const rows = await auditRows("account_confirmed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(workspaceId);
    expect(rows[0]?.user_id).toBe(userId);
    expect(rows[0]?.ip_hash).toBeInstanceOf(Buffer);
    expect(rows[0]?.ip_hash?.length).toBe(16);
  });

  it("appends confirmation_failed with no workspace and no user on a refused token", async () => {
    const { workspaceId } = await registerUnconfirmed("alice@example.test");

    await caller()
      .caller.auth.confirm({ token: `${workspaceId}.AAAAAAAAAAAAAAAAAAAAAA` })
      .catch(() => undefined);

    const rows = await auditRows("confirmation_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBeNull();
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.detail).toEqual({ reason: "token_invalid" });
  });

  it("records reason already_confirmed when a live token meets an account confirmed outside the flow", async () => {
    const { userId, token } = await registerUnconfirmed("alice@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${userId}`,
    );

    await caller()
      .caller.auth.confirm({ token })
      .catch(() => undefined);

    const rows = await auditRows("confirmation_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toEqual({ reason: "already_confirmed" });
    expect(rows[0]?.workspace_id).toBeNull();
    expect(rows[0]?.user_id).toBeNull();
  });

  it("records confirmation_failed for a malformed token too", async () => {
    await caller()
      .caller.auth.confirm({ token: "garbage" })
      .catch(() => undefined);

    expect(await auditRows("confirmation_failed")).toHaveLength(1);
  });

  it("does not record account_confirmed when confirmation is refused", async () => {
    await caller()
      .caller.auth.confirm({ token: "garbage" })
      .catch(() => undefined);

    expect(await auditRows("account_confirmed")).toHaveLength(0);
  });

  it("appends confirmation_resent with workspace and user when an unconfirmed account asks again", async () => {
    const { userId, workspaceId } = await registerUnconfirmed("alice@example.test");

    await caller().caller.auth.resendConfirmation({ email: "alice@example.test" });

    const rows = await auditRows("confirmation_resent");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(workspaceId);
    expect(rows[0]?.user_id).toBe(userId);
  });

  it("never puts an email address or any form of the token in any audit row (Article VIII)", async () => {
    const email = "alice@example.test";
    const { token } = await registerUnconfirmed(email);
    await caller().caller.auth.resendConfirmation({ email });
    const resent = lastEmail().token;
    await caller()
      .caller.auth.confirm({ token })
      .catch(() => undefined);
    await caller().caller.auth.confirm({ token: resent });

    const everything = JSON.stringify(await auditRows());
    const secrets = [
      email,
      "alice",
      ...[token, resent].flatMap((t) => [
        t,
        t.split(".")[1] ?? "",
        sha256Hex(t.split(".")[1] ?? ""),
      ]),
    ];

    expect((await auditRows()).length).toBeGreaterThanOrEqual(3);
    for (const secret of secrets) {
      expect(everything, `audit rows must not contain ${secret.slice(0, 6)}…`).not.toContain(
        secret,
      );
    }
  });
});
