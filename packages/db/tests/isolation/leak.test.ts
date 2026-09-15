import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withWorkspace } from "../../src/rls.js";
import {
  appDatabase,
  assertAppRoleIsNotPrivileged,
  closePools,
  resetWorkspaces,
  seedWorkspace,
  type SeededWorkspace,
} from "../support/database.js";

/**
 * Article I, the gate this feature owes: "Every tenant-scoped table MUST have a
 * cross-tenant leak test asserting that a session bound to workspace A can
 * read, update, and delete zero rows belonging to workspace B. These tests run
 * against real PostgreSQL, not a mock."
 *
 * Every assertion below runs as the non-owner `app` role. A leak test run as
 * the owner is vacuous, so the role is verified before anything else.
 */

/**
 * Drizzle wraps a driver error as `Failed query: ...` and hangs the real
 * PostgreSQL message off `cause`. Asserting on the wrapper message would pass
 * for any failure at all, including a typo in the SQL, so the cause chain is
 * walked to the root and matched there.
 */
async function expectRejection(work: Promise<unknown>, pattern: RegExp): Promise<void> {
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

/** Every tenant-scoped table, with the column that ties a row to its workspace. */
const TENANT_TABLES = [
  { table: "workspaces", tenantColumn: "id" },
  { table: "users", tenantColumn: "workspace_id" },
  { table: "sessions", tenantColumn: "workspace_id" },
  { table: "audit_events", tenantColumn: "workspace_id" },
] as const;

describe("cross-tenant isolation", () => {
  let alpha: SeededWorkspace;
  let beta: SeededWorkspace;

  beforeAll(async () => {
    await assertAppRoleIsNotPrivileged();
  });

  afterAll(async () => {
    await closePools();
  });

  beforeEach(async () => {
    await resetWorkspaces();
    alpha = await seedWorkspace("alpha");
    beta = await seedWorkspace("beta");
  });

  describe.each(TENANT_TABLES)("$table", ({ table, tenantColumn }) => {
    it("reads zero rows belonging to the other workspace", async () => {
      const rows = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute<{ count: string }>(
          sql`select count(*)::text as count from ${sql.identifier(table)}
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rows[0]?.count;
      });

      expect(rows).toBe("0");
    });

    it("sees only its own rows when it reads without a filter", async () => {
      const foreign = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute<{ count: string }>(
          sql`select count(*)::text as count from ${sql.identifier(table)}
              where ${sql.identifier(tenantColumn)} <> ${alpha.workspaceId}`,
        );
        return result.rows[0]?.count;
      });

      expect(foreign).toBe("0");
    });

    it("updates zero rows belonging to the other workspace", async () => {
      // audit_events is append-only by grant, so UPDATE is refused outright
      // rather than filtered to zero rows. Both outcomes are "cannot touch it".
      const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute(
          sql`update ${sql.identifier(table)} set "created_at" = now()
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rowCount ?? 0;
      });

      if (table === "audit_events") {
        await expectRejection(attempt, /permission denied|column "created_at"/i);
      } else {
        await expect(attempt).resolves.toBe(0);
      }
    });

    it("deletes zero rows belonging to the other workspace", async () => {
      const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute(
          sql`delete from ${sql.identifier(table)}
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rowCount ?? 0;
      });

      if (table === "audit_events") {
        await expectRejection(attempt, /permission denied/i);
      } else {
        await expect(attempt).resolves.toBe(0);
      }

      // And the row is still there, seen from its own workspace.
      const survived = await withWorkspace(appDatabase(), beta.workspaceId, async (tx) => {
        const result = await tx.execute<{ count: string }>(
          sql`select count(*)::text as count from ${sql.identifier(table)}
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rows[0]?.count;
      });
      expect(survived).not.toBe("0");
    });
  });

  it("cannot reach a foreign record by its direct identifier (FR-003)", async () => {
    // Story 1 scenario 2: "responds as if the record does not exist".
    const found = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "users" where "id" = ${beta.userId}`,
      );
      return result.rows[0]?.count;
    });

    expect(found).toBe("0");
  });

  it("cannot insert a row into another workspace — WITH CHECK, not just USING", async () => {
    // USING alone would filter reads while still permitting this INSERT.
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "users" ("workspace_id", "email", "display_name", "password_hash")
            values (${beta.workspaceId}, ${"smuggled@example.test"}, ${"smuggled"}, ${"x"})`,
      ),
    );

    await expectRejection(attempt, /row-level security/i);
  });

  it("cannot move its own row into another workspace", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`update "users" set "workspace_id" = ${beta.workspaceId} where "id" = ${alpha.userId}`,
      ),
    );

    await expectRejection(attempt, /row-level security/i);
  });

  it("sees nothing at all when no workspace is set", async () => {
    // An unscoped connection must not mean "see everything". current_setting
    // returns NULL, NULL compares to nothing, so the safe direction is taken.
    const db = appDatabase();
    const result = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from "users"`,
    );

    expect(result.rows[0]?.count).toBe("0");
  });

  it("does not leak the workspace setting across pooled transactions", async () => {
    // SET LOCAL dies with its transaction. A plain SET would survive on the
    // pooled connection and hand the next request the previous workspace.
    const db = appDatabase();

    await withWorkspace(db, alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "users"`,
      );
      expect(result.rows[0]?.count).toBe("1");
    });

    const after = await db.execute<{ setting: string | null }>(
      sql`select nullif(current_setting('app.workspace_id', true), '') as setting`,
    );
    expect(after.rows[0]?.setting).toBeNull();
  });
});
