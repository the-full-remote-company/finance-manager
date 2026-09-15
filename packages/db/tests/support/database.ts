import { sql } from "drizzle-orm";
import pg from "pg";
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

  return { workspaceId, userId, sessionId, auditEventId };
}
