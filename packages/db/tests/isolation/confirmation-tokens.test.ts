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
 * Article I: the T030 harness applied to `confirmation_tokens`, per T013.
 * Workspace A cannot read, update, or delete workspace B's tokens.
 */
describe("cross-tenant isolation — confirmation_tokens (T013)", () => {
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

    // Seed confirmation tokens for each workspace
    await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into "confirmation_tokens" ("workspace_id", "user_id", "token_hash", "expires_at")
        values (${alpha.workspaceId}, ${alpha.userId}, 'alpha_token_hash', now() + interval '24 hours')
      `);
    });

    await withWorkspace(appDatabase(), beta.workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into "confirmation_tokens" ("workspace_id", "user_id", "token_hash", "expires_at")
        values (${beta.workspaceId}, ${beta.userId}, 'beta_token_hash', now() + interval '24 hours')
      `);
    });
  });

  it("reads zero confirmation tokens belonging to the other workspace", async () => {
    const rows = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "confirmation_tokens"
            where "workspace_id" = ${beta.workspaceId}`,
      );
      return result.rows[0]?.count;
    });

    expect(rows).toBe("0");
  });

  it("updates zero confirmation tokens belonging to the other workspace", async () => {
    const attempt = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute(
        sql`update "confirmation_tokens"
            set "superseded_at" = now()
            where "workspace_id" = ${beta.workspaceId}`,
      );
      return result.rowCount ?? 0;
    });

    expect(attempt).toBe(0);

    // Verify beta's token was not modified
    const survived = await withWorkspace(appDatabase(), beta.workspaceId, async (tx) => {
      const result = await tx.execute<{ superseded_at: string | null }>(
        sql`select "superseded_at" from "confirmation_tokens"
            where "token_hash" = 'beta_token_hash'`,
      );
      return result.rows[0]?.superseded_at;
    });

    expect(survived).toBeNull();
  });

  it("deletes zero confirmation tokens belonging to the other workspace", async () => {
    const attempt = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute(
        sql`delete from "confirmation_tokens"
            where "workspace_id" = ${beta.workspaceId}`,
      );
      return result.rowCount ?? 0;
    });

    expect(attempt).toBe(0);

    // Verify beta's token still exists
    const survived = await withWorkspace(appDatabase(), beta.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "confirmation_tokens"
            where "workspace_id" = ${beta.workspaceId}`,
      );
      return result.rows[0]?.count;
    });

    expect(survived).not.toBe("0");
  });

  it("cannot reach a foreign confirmation token by its direct identifier", async () => {
    // First, get the token ID from beta workspace
    const tokenId = await withWorkspace(appDatabase(), beta.workspaceId, async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select "id" from "confirmation_tokens" where "token_hash" = 'beta_token_hash'`,
      );
      return result.rows[0]?.id;
    });

    expect(tokenId).toBeDefined();

    // Try to read beta's token while in alpha workspace context
    const found = await withWorkspace(appDatabase(), alpha.workspaceId, async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from "confirmation_tokens" where "id" = ${tokenId}`,
      );
      return result.rows[0]?.count;
    });

    expect(found).toBe("0");
  });
});
