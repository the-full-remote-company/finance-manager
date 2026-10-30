import { sql } from "drizzle-orm";
import pg from "pg";
import { expect } from "vitest";
import { createDatabase, createPool, type Database } from "../../src/client.js";

/**
 * Test connections.
 *
 * Two pools, deliberately:
 *
 *  - `app`   — the non-owner role the application uses. Every isolation
 *              assertion runs through this one, because a leak test that runs
 *              as the owner proves nothing: RLS does not apply to an owner.
 *  - `owner` — used only to seed fixtures and to inspect catalogue tables.
 *
 * Article VII: these point at the containerised PostgreSQL and require no
 * cloud account.
 */
const APP_URL = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/finance";
const OWNER_URL = process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance";

let appPool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;

export function appDatabase(): Database {
  appPool ??= createPool({ connectionString: APP_URL });
  return createDatabase(appPool);
}

export function ownerDatabase(): Database {
  ownerPool ??= createPool({ connectionString: OWNER_URL });
  return createDatabase(ownerPool);
}

export async function closePools(): Promise<void> {
  await appPool?.end();
  await ownerPool?.end();
  appPool = undefined;
  ownerPool = undefined;
}

/**
 * Drizzle wraps a driver error as `Failed query: ...` and hangs the real
 * PostgreSQL message off `cause`. Asserting on the wrapper message would pass
 * for any failure at all, including a typo in the SQL, so the cause chain is
 * walked to the root and matched there.
 */
export async function expectRejection(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await work;
  } catch (error) {
    thrown = error;
  }

  expect(thrown, "expected the database to reject this statement").toBeDefined();

  const messages: string[] = [];
  let current: unknown = thrown;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }

  expect(messages.join(" | ")).toMatch(pattern);
}

/** Confirms the app role really is RLS-bound, so a green suite cannot be a false negative. */
export async function assertAppRoleIsNotPrivileged(): Promise<void> {
  const db = appDatabase();
  const result = await db.execute<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    current_user: string;
  }>(
    sql`select r.rolsuper, r.rolbypassrls, current_user from pg_roles r where r.rolname = current_user`,
  );
  const role = result.rows[0];
  if (!role) throw new Error("could not read the current role");
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `the test app role (${role.current_user}) is superuser or BYPASSRLS; every isolation assertion would be vacuous`,
    );
  }
}

/** Truncates every tenant table between tests, as owner. */
export async function resetWorkspaces(): Promise<void> {
  const db = ownerDatabase();
  await db.execute(sql`truncate table "workspaces" cascade`);
  await db.execute(sql`truncate table "audit_events"`);
}

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly auditEventId: string;
  readonly accountId: string;
  readonly categoryId: string;
  readonly commitmentId: string;
  readonly commitmentAmountId: string;
  readonly amountOverrideId: string;
}

/**
 * Seeds one workspace with a row in every tenant-scoped table, as owner.
 * Returns the identifiers so a test can attempt to reach them from the *other*
 * workspace's session — reaching by direct identifier is precisely what FR-003
 * forbids.
 */
export async function seedWorkspace(name: string): Promise<SeededWorkspace> {
  const db = ownerDatabase();

  const workspace = await db.execute<{ id: string }>(
    sql`insert into "workspaces" ("name") values (${name}) returning "id"`,
  );
  const workspaceId = workspace.rows[0]?.id;
  if (!workspaceId) throw new Error("failed to seed workspace");

  const user = await db.execute<{ id: string }>(
    sql`insert into "users" ("workspace_id", "email", "display_name", "password_hash")
        values (${workspaceId}, ${`${name}@example.test`}, ${name}, ${"argon2id$placeholder"})
        returning "id"`,
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("failed to seed user");

  const session = await db.execute<{ id: string }>(
    sql`insert into "sessions" ("workspace_id", "user_id", "token_hash", "expires_at")
        values (${workspaceId}, ${userId}, ${`hash-${name}`}, now() + interval '30 days')
        returning "id"`,
  );
  const sessionId = session.rows[0]?.id;
  if (!sessionId) throw new Error("failed to seed session");

  const audit = await db.execute<{ id: string }>(
    sql`insert into "audit_events" ("workspace_id", "user_id", "type")
        values (${workspaceId}, ${userId}, 'sign_in_succeeded')
        returning "id"`,
  );
  const auditEventId = audit.rows[0]?.id;
  if (!auditEventId) throw new Error("failed to seed audit event");

  const account = await db.execute<{ id: string }>(
    sql`insert into "accounts" ("workspace_id", "name", "sort_order")
        values (${workspaceId}, ${`${name}-konto`}, 0)
        returning "id"`,
  );
  const accountId = account.rows[0]?.id;
  if (!accountId) throw new Error("failed to seed account");

  const category = await db.execute<{ id: string }>(
    sql`insert into "categories" ("workspace_id", "name", "direction", "sort_order")
        values (${workspaceId}, ${`${name}-kategorie`}, 'expense', 0)
        returning "id"`,
  );
  const categoryId = category.rows[0]?.id;
  if (!categoryId) throw new Error("failed to seed category");

  const commitment = await db.execute<{ id: string }>(
    sql`insert into "commitments"
          ("workspace_id", "name", "direction", "category_id", "source_account_id", "rhythm", "start_date")
        values (${workspaceId}, ${`${name}-verpflichtung`}, 'expense', ${categoryId}, ${accountId}, 'monthly', '2026-01-01')
        returning "id"`,
  );
  const commitmentId = commitment.rows[0]?.id;
  if (!commitmentId) throw new Error("failed to seed commitment");

  const commitmentAmount = await db.execute<{ id: string }>(
    sql`insert into "commitment_amounts" ("workspace_id", "commitment_id", "effective_from", "amount_minor")
        values (${workspaceId}, ${commitmentId}, '2026-01-01', 1000)
        returning "id"`,
  );
  const commitmentAmountId = commitmentAmount.rows[0]?.id;
  if (!commitmentAmountId) throw new Error("failed to seed commitment amount");

  const amountOverride = await db.execute<{ id: string }>(
    sql`insert into "amount_overrides" ("workspace_id", "commitment_id", "month", "amount_minor")
        values (${workspaceId}, ${commitmentId}, 24312, 2000)
        returning "id"`,
  );
  const amountOverrideId = amountOverride.rows[0]?.id;
  if (!amountOverrideId) throw new Error("failed to seed amount override");

  return {
    workspaceId,
    userId,
    sessionId,
    auditEventId,
    accountId,
    categoryId,
    commitmentId,
    commitmentAmountId,
    amountOverrideId,
  };
}
