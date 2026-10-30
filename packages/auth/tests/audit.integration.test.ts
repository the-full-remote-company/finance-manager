import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, createPool, sql } from "@finance/db";
import { AUDIT_DETAIL_KEYS, hashIp, recordAuditEvent } from "../src/audit.js";

/**
 * Article VIII: an append-only audit log records authentication, export and
 * deletion. It MUST NOT contain personal data, account identifiers or monetary
 * amounts — the same prohibition that applies to application logs.
 *
 * These tests run as the OWNER, not the app role: audit rows for a failed
 * sign-in have no workspace, so no tenant session could read them back to
 * assert on. The app role's inability to UPDATE or DELETE them is asserted in
 * the isolation suite instead.
 */
const pool = createPool({
  connectionString:
    process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance",
});
const db = createDatabase(pool);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`truncate table "audit_events"`);
  await db.execute(sql`truncate table "workspaces" cascade`);
});

async function readEvents(): Promise<
  {
    type: string;
    workspace_id: string | null;
    user_id: string | null;
    detail: Record<string, unknown>;
  }[]
> {
  const result = await db.execute<{
    type: string;
    workspace_id: string | null;
    user_id: string | null;
    detail: Record<string, unknown>;
  }>(
    sql`select "type", "workspace_id", "user_id", "detail" from "audit_events" order by "occurred_at"`,
  );
  return result.rows;
}

describe("audit log", () => {
  it("records a successful sign-in with its workspace and user", async () => {
    const workspace = await db.execute<{ id: string }>(
      sql`insert into "workspaces" ("name") values ('Haushalt') returning "id"`,
    );
    const workspaceId = workspace.rows[0]?.id;
    if (!workspaceId) throw new Error("seed failed");

    const user = await db.execute<{ id: string }>(
      sql`insert into "users" ("workspace_id", "email", "display_name", "password_hash")
          values (${workspaceId}, 'person@example.test', 'Person', 'hash') returning "id"`,
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("seed failed");

    await recordAuditEvent(db, {
      type: "sign_in_succeeded",
      workspaceId,
      userId,
      ip: "203.0.113.7",
    });

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("sign_in_succeeded");
    expect(events[0]?.workspace_id).toBe(workspaceId);
  });

  it("records a failed sign-in, which has no known workspace", async () => {
    // FR-006 requires authentication events recorded on failure as well as
    // success, and a failed attempt has no workspace to attribute.
    await recordAuditEvent(db, {
      type: "sign_in_failed",
      workspaceId: null,
      userId: null,
      ip: "203.0.113.7",
    });

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.workspace_id).toBeNull();
  });

  it("stores a hash of the IP address, never the address", async () => {
    await recordAuditEvent(db, {
      type: "sign_in_failed",
      workspaceId: null,
      userId: null,
      ip: "203.0.113.7",
    });

    const result = await db.execute<{ ip_hash: Buffer | null; encoded: string }>(
      sql`select "ip_hash", encode("ip_hash", 'hex') as encoded from "audit_events"`,
    );
    const row = result.rows[0];

    expect(row?.ip_hash).not.toBeNull();
    expect(row?.encoded).not.toContain("203");
    expect(row?.encoded).toBe(hashIp("203.0.113.7").toString("hex"));
  });

  it("writes no email address, account name or monetary amount into detail", async () => {
    await recordAuditEvent(db, {
      type: "sign_in_failed",
      workspaceId: null,
      userId: null,
      ip: "203.0.113.7",
      // A caller trying to be helpful. Article VIII says no.
      detail: { reason: "bad_password" },
    });

    const events = await readEvents();
    const detail = events[0]?.detail ?? {};

    // The recorded keys are a fixed allow-list, so a future caller cannot
    // widen the payload by passing a richer object.
    for (const key of Object.keys(detail)) {
      expect(AUDIT_DETAIL_KEYS).toContain(key);
    }

    const serialised = JSON.stringify(detail);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/\d+[,.]\d{2}/);
  });

  it("refuses a detail payload carrying an obvious identifier", async () => {
    // Defence against the helpful caller: rejected loudly at the write, not
    // silently stripped, so the mistake is visible in development.
    await expect(
      recordAuditEvent(db, {
        type: "sign_in_failed",
        workspaceId: null,
        userId: null,
        ip: "203.0.113.7",
        detail: { email: "person@example.test" } as never,
      }),
    ).rejects.toThrow(/detail/i);
  });

  it("retains an account_deleted row with no workspace and no user", async () => {
    // The Article VIII tension, resolved deliberately in data-model.md: the
    // event survives erasure, carrying only a type, a timestamp and a hashed IP.
    await recordAuditEvent(db, {
      type: "account_deleted",
      workspaceId: null,
      userId: null,
      ip: "203.0.113.7",
    });

    const events = await readEvents();
    expect(events[0]?.type).toBe("account_deleted");
    expect(events[0]?.workspace_id).toBeNull();
    expect(events[0]?.user_id).toBeNull();
  });
});
