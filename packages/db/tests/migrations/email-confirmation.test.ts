import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * T039 — feature 002, FR-019.
 * The migration is run the way it will be for a real user: on a database that
 * is in its feature-001 state and already holds accounts. Every one of them
 * must come out confirmed, with a confirmed-at at migration time, so nobody
 * who could sign in yesterday is asked to confirm an address today.
 *
 * A scratch database keeps this from touching the shared test database, whose
 * schema every other suite depends on.
 */
const OWNER_URL = process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance";
const SCRATCH = "finance_migration_test";

const ownerUrlFor = (database: string): string => {
  const url = new URL(OWNER_URL);
  url.pathname = `/${database}`;
  return url.toString();
};

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const migrationFiles = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
const indexOf = (prefix: string): number => migrationFiles.findIndex((n) => n.startsWith(prefix));

/** Runs one migration file statement by statement, as drizzle's breakpoints define them. */
async function apply(client: pg.Client, file: string): Promise<void> {
  const text = readFileSync(new URL(file, MIGRATIONS), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") await client.query(statement);
  }
}

let admin: pg.Client | undefined;
let ownerClient: pg.Client | undefined;

/** The scratch-database connection; throws, rather than hiding a failed setup behind a TypeError. */
function owner(): pg.Client {
  if (!ownerClient) throw new Error("the scratch database was not set up");
  return ownerClient;
}
let migratedAt: Date;

const LEGACY = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "legacy-one@example.test" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", email: "legacy-two@example.test" },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", email: "legacy-three@example.test" },
] as const;

beforeAll(async () => {
  expect(indexOf("0005_"), "migration 0005 must exist").toBeGreaterThan(0);

  const adminClient = new pg.Client({ connectionString: OWNER_URL });
  admin = adminClient;
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await adminClient.query(`CREATE DATABASE ${SCRATCH}`);

  ownerClient = new pg.Client({ connectionString: ownerUrlFor(SCRATCH) });
  await ownerClient.connect();

  // The schema exactly as feature 001 left it.
  for (const file of migrationFiles.slice(0, indexOf("0005_"))) await apply(owner(), file);

  // Three accounts that exist before the feature: inserted the way feature 001
  // inserted them, with no notion of confirmation.
  for (const [i, user] of LEGACY.entries()) {
    const workspace = `bbbbbbbb-0000-4000-8000-00000000000${String(i + 1)}`;
    await owner().query(`INSERT INTO "workspaces" ("id", "name") VALUES ($1, $2)`, [
      workspace,
      `Legacy ${String(i + 1)}`,
    ]);
    await owner().query(
      `INSERT INTO "users" ("id", "workspace_id", "email", "display_name", "password_hash")
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, workspace, user.email, `Legacy ${String(i + 1)}`, "$argon2id$placeholder"],
    );
  }

  const columns = await owner().query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users' AND column_name IN ('confirmed', 'confirmed_at')`,
  );
  expect(columns.rowCount, "the legacy state must predate the migration").toBe(0);

  const clock = await owner().query<{ now: Date }>("SELECT clock_timestamp() AS now");
  migratedAt = clock.rows[0]?.now ?? new Date();

  // The migrations this feature adds.
  for (const file of migrationFiles.slice(indexOf("0005_"))) await apply(owner(), file);
}, 120_000);

afterAll(async () => {
  await ownerClient?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await admin?.end();
});

describe("migration 0005 on a database that already has accounts (T039)", () => {
  it("marks every pre-existing account confirmed", async () => {
    const result = await owner().query<{ email: string; confirmed: boolean }>(
      `SELECT "email", "confirmed" FROM "users" ORDER BY "email"`,
    );

    expect(result.rows).toHaveLength(LEGACY.length);
    expect(result.rows.every((row) => row.confirmed)).toBe(true);
  });

  it("stamps confirmed_at with the migration's time, not null and not the epoch", async () => {
    const result = await owner().query<{ confirmed_at: Date | null }>(
      `SELECT "confirmed_at" FROM "users"`,
    );
    const now = Date.now();

    for (const row of result.rows) {
      expect(row.confirmed_at).not.toBeNull();
      const at = (row.confirmed_at ?? new Date(0)).getTime();
      expect(at).toBeGreaterThanOrEqual(migratedAt.getTime() - 1000);
      expect(at).toBeLessThanOrEqual(now + 1000);
    }
  });

  it("creates confirmation_tokens empty, under forced row-level security", async () => {
    const rows = await owner().query(`SELECT count(*)::int AS n FROM "confirmation_tokens"`);
    expect(rows.rows[0]).toEqual({ n: 0 });

    const rls = await owner().query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'confirmation_tokens'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("lets a legacy account sign in: app_authenticate reports it confirmed", async () => {
    const app = new pg.Client({
      connectionString: ownerUrlFor(SCRATCH).replace("//owner:owner@", "//app:app@"),
    });
    await app.connect();
    try {
      const result = await app.query<{ confirmed: boolean }>(
        `SELECT "confirmed" FROM app_authenticate($1)`,
        [LEGACY[0].email],
      );
      expect(result.rows).toEqual([{ confirmed: true }]);
    } finally {
      await app.end();
    }
  });

  it("a registration made after the migration is unconfirmed when it says so (FR-001)", async () => {
    await owner().query(`INSERT INTO "workspaces" ("id", "name") VALUES ($1, 'New')`, [
      "cccccccc-0000-4000-8000-000000000001",
    ]);
    await owner().query(
      `INSERT INTO "users" ("id", "workspace_id", "email", "display_name", "password_hash", "confirmed")
       VALUES ($1, $2, 'new@example.test', 'New', 'x', false)`,
      ["cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000001"],
    );

    const result = await owner().query<{ confirmed: boolean; confirmed_at: Date | null }>(
      `SELECT "confirmed", "confirmed_at" FROM "users" WHERE "email" = 'new@example.test'`,
    );
    expect(result.rows).toEqual([{ confirmed: false, confirmed_at: null }]);
  });

  it("every audit event type the confirmation flow writes exists after the migrations", async () => {
    const result = await owner().query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'audit_event_type'`,
    );
    const labels = result.rows.map((row) => row.enumlabel);
    for (const type of ["account_confirmed", "confirmation_resent", "confirmation_failed"]) {
      expect(labels).toContain(type);
    }
  });
});
