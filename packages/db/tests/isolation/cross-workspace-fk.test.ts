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
 * data-model.md: "A foreign key alone cannot prevent a commitment in
 * workspace A pointing at a category in workspace B, because the reference
 * target is only checked for existence." Every intra-tenant reference is
 * therefore a *composite* foreign key carrying `workspace_id`, which makes
 * the mismatch unrepresentable — rejected by the constraint itself, not by
 * application code (T071).
 *
 * Each insert here targets its OWN workspace's `workspace_id` (so RLS's
 * `WITH CHECK` passes) but a REFERENCE belonging to the other workspace —
 * isolating the composite foreign key as the thing doing the rejecting.
 */
describe("cross-workspace composite foreign keys", () => {
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

  it("rejects a commitment in workspace A referencing a category in workspace B", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitments"
              ("workspace_id", "name", "direction", "category_id", "source_account_id", "rhythm", "start_date")
            values (${alpha.workspaceId}, 'cross-category', 'expense', ${beta.categoryId}, ${alpha.accountId}, 'monthly', '2026-01-01')`,
      ),
    );

    await expectRejection(attempt, /foreign key|violates/i);
  });

  it("rejects a commitment in workspace A referencing a source account in workspace B", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitments"
              ("workspace_id", "name", "direction", "category_id", "source_account_id", "rhythm", "start_date")
            values (${alpha.workspaceId}, 'cross-account', 'expense', ${alpha.categoryId}, ${beta.accountId}, 'monthly', '2026-01-01')`,
      ),
    );

    await expectRejection(attempt, /foreign key|violates/i);
  });

  it("rejects a commitment in workspace A whose transfer destination is in workspace B", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitments"
              ("workspace_id", "name", "direction", "category_id", "source_account_id", "transfer_account_id", "rhythm", "start_date")
            values (${alpha.workspaceId}, 'cross-transfer', 'expense', ${alpha.categoryId}, ${alpha.accountId}, ${beta.accountId}, 'monthly', '2026-01-01')`,
      ),
    );

    await expectRejection(attempt, /foreign key|violates/i);
  });

  it("rejects a commitment amount in workspace A referencing a commitment in workspace B", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitment_amounts" ("workspace_id", "commitment_id", "effective_from", "amount_minor")
            values (${alpha.workspaceId}, ${beta.commitmentId}, '2026-02-01', 500)`,
      ),
    );

    await expectRejection(attempt, /foreign key|violates/i);
  });

  it("rejects an amount override in workspace A referencing a commitment in workspace B", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "amount_overrides" ("workspace_id", "commitment_id", "month", "amount_minor")
            values (${alpha.workspaceId}, ${beta.commitmentId}, 24313, 500)`,
      ),
    );

    await expectRejection(attempt, /foreign key|violates/i);
  });

  it("accepts a commitment whose references all belong to its own workspace", async () => {
    const attempt = withWorkspace(appDatabase(), alpha.workspaceId, async (tx) =>
      tx.execute(
        sql`insert into "commitments"
              ("workspace_id", "name", "direction", "category_id", "source_account_id", "rhythm", "start_date")
            values (${alpha.workspaceId}, 'same-workspace', 'expense', ${alpha.categoryId}, ${alpha.accountId}, 'monthly', '2026-01-01')`,
      ),
    );

    await expect(attempt).resolves.toBeDefined();
  });
});
