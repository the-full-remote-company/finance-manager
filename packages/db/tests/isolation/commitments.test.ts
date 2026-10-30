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
 * Article I: the T030 harness applied to `commitments`, `commitment_amounts`
 * and `amount_overrides`, per T070.
 */
const TENANT_TABLES = [
  { table: "commitments", tenantColumn: "workspace_id" },
  { table: "commitment_amounts", tenantColumn: "workspace_id" },
  { table: "amount_overrides", tenantColumn: "workspace_id" },
] as const;

describe("cross-tenant isolation — commitments", () => {
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

  it("cannot reach a foreign commitment by its direct identifier (FR-003)", async () => {
    const found = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "commitments" where "id" = ${beta.commitmentId}`,
      );
      return result.rows[0]?.count;
    });
    expect(found).toBe("0");
  });

  it("cannot insert a commitment into another workspace — WITH CHECK, not just USING", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitments"
              ("workspace_id", "name", "direction", "category_id", "source_account_id", "rhythm", "start_date")
            values (${beta.workspaceId}, 'smuggled', 'expense', ${alpha.categoryId}, ${alpha.accountId}, 'monthly', '2026-01-01')`,
      ),
    );
    await expectRejection(attempt, /row-level security/i);
  });

  it("cannot insert a commitment amount into another workspace — WITH CHECK, not just USING", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitment_amounts" ("workspace_id", "commitment_id", "effective_from", "amount_minor")
            values (${beta.workspaceId}, ${alpha.commitmentId}, '2026-02-01', 500)`,
      ),
    );
    await expectRejection(attempt, /row-level security/i);
  });

  it("cannot insert an amount override into another workspace — WITH CHECK, not just USING", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "amount_overrides" ("workspace_id", "commitment_id", "month", "amount_minor")
            values (${beta.workspaceId}, ${alpha.commitmentId}, 24313, 500)`,
      ),
    );
    await expectRejection(attempt, /row-level security/i);
  });
});
