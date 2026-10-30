import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/**
 * Runs `work` inside one transaction that has already executed
 * `SET LOCAL app.workspace_id`, which is what every RLS policy reads.
 *
 * `SET LOCAL`, never `SET`: the setting must die with the transaction. A plain
 * `SET` persists on the pooled connection and would leak the previous
 * request's workspace into the next one — the exact failure Article I calls
 * "the one failure that ends the product".
 *
 * The value is passed as a bound parameter through set_config rather than
 * interpolated into the statement text. `SET LOCAL` does not accept a
 * placeholder, and string-building a session variable from a request value is
 * an injection waiting to happen.
 *
 * This is the database half of the defence. Application-layer scoping in the
 * tRPC middleware is required in addition, never instead (Article I).
 */
export async function withWorkspace<T>(
  db: Database,
  workspaceId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  assertUuid(workspaceId);

  return db.transaction(async (tx) => {
    // `true` is is_local: scoped to this transaction, undone at COMMIT/ROLLBACK.
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return work(tx);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string): void {
  if (!UUID.test(value)) {
    throw new TypeError("workspaceId must be a UUID");
  }
}

/**
 * Reads back the workspace the current transaction is scoped to. Used by the
 * isolation tests to prove the setting is actually applied rather than assumed,
 * and by nothing in production code.
 */
export async function currentWorkspaceId(db: Database): Promise<string | null> {
  const result = await db.execute<{ workspace_id: string | null }>(
    sql`select nullif(current_setting('app.workspace_id', true), '') as workspace_id`,
  );
  return result.rows[0]?.workspace_id ?? null;
}
