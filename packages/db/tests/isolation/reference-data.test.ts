import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withWorkspace } from "../../src/rls.js";
import {
  appDatabase,
  assertAppRoleIsNotPrivileged,
  closePools,
  expectRejection,
  resetWorkspaces,
  seedWorkspace,
  type SeededWorkspace,
} from "../support/database.js";

/**
 * Article I: "A new tenant-scoped table without its leak test must not merge."
 * `accounts` and `categories` are the first reference-data tables this feature
 * introduces; this is the T030 harness applied to them, per T069.
 */
const TENANT_TABLES = [
  { table: "accounts", tenantColumn: "workspace_id" },
  { table: "categories", tenantColumn: "workspace_id" },
] as const;

describe("cross-tenant isolation — reference data", () => {
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

    it("updates zero rows belonging to the other workspace", async () => {
      const attempt = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute(
          sql`update ${sql.identifier(table)} set "updated_at" = now()
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rowCount ?? 0;
      });

      expect(attempt).toBe(0);
    });

    it("deletes zero rows belonging to the other workspace", async () => {
      const attempt = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
        const result = await tx.execute(
          sql`delete from ${sql.identifier(table)}
              where ${sql.identifier(tenantColumn)} = ${beta.workspaceId}`,
        );
        return result.rowCount ?? 0;
      });

      expect(attempt).toBe(0);

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

  it("cannot reach a foreign account by its direct identifier (FR-003)", async () => {
    const found = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "accounts" where "id" = ${beta.accountId}`,
      );
      return result.rows[0]?.count;
    });
    expect(found).toBe("0");
  });

  it("cannot reach a foreign category by its direct identifier (FR-003)", async () => {
    const found = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "categories" where "id" = ${beta.categoryId}`,
      );
      return result.rows[0]?.count;
    });
    expect(found).toBe("0");
  });

  it("cannot insert an account into another workspace — WITH CHECK, not just USING", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "accounts" ("workspace_id", "name", "sort_order")
            values (${beta.workspaceId}, 'smuggled', 0)`,
      ),
    );
    await expectRejection(attempt, /row-level security/i);
  });

  it("cannot insert a category into another workspace — WITH CHECK, not just USING", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "categories" ("workspace_id", "name", "direction", "sort_order")
            values (${beta.workspaceId}, 'smuggled', 'expense', 0)`,
      ),
    );
    await expectRejection(attempt, /row-level security/i);
  });
});
