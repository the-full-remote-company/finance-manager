import { createHash } from "node:crypto";
import { sql, type Database } from "@finance/db";

/**
 * The append-only audit log required by Article VIII and FR-006.
 *
 * "Personal data, account identifiers, and monetary amounts MUST NOT be
 * written to application logs or error-reporting payloads." The same applies
 * here, and is enforced rather than documented: `detail` accepts only the keys
 * in AUDIT_DETAIL_KEYS, and anything else is refused at the write.
 *
 * Refused loudly rather than stripped silently, so a caller that tries to log
 * an email address finds out in development instead of shipping it.
 */

export type AuditEventType =
  "sign_in_succeeded" | "sign_in_failed" | "signed_out" | "export_performed" | "account_deleted";

/**
 * The complete set of keys permitted in `detail`. All are non-identifying.
 *
 * `reason` is a fixed machine token ("bad_password", "unknown_user"), never a
 * sentence and never a value the user supplied.
 */
export const AUDIT_DETAIL_KEYS = ["reason", "schemaVersion", "recordCount"] as const;

export type AuditDetail = Partial<{
  reason: string;
  schemaVersion: number;
  recordCount: number;
}>;

export interface AuditEventInput {
  readonly type: AuditEventType;
  /** Null for a failed sign-in, which has no known workspace, and for a retained account_deleted row. */
  readonly workspaceId: string | null;
  readonly userId: string | null;
  readonly ip?: string | null;
  readonly detail?: AuditDetail;
}

/**
 * A hash, never the address (Article VIII). Truncated to 16 bytes: enough to
 * correlate repeated attempts, not enough to be a durable identifier.
 */
export function hashIp(ip: string): Buffer {
  return createHash("sha256").update(ip, "utf8").digest().subarray(0, 16);
}

function assertDetailIsNotIdentifying(detail: AuditDetail): void {
  for (const key of Object.keys(detail)) {
    if (!(AUDIT_DETAIL_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `audit detail may not carry ${JSON.stringify(key)}: Article VIII forbids personal data, account identifiers and monetary amounts in the audit log. Permitted keys: ${AUDIT_DETAIL_KEYS.join(", ")}`,
      );
    }
  }
}

export async function recordAuditEvent(db: Database, event: AuditEventInput): Promise<void> {
  const detail = event.detail ?? {};
  assertDetailIsNotIdentifying(detail);

  const ipHash = event.ip == null ? null : hashIp(event.ip);

  await db.execute(
    sql`insert into "audit_events" ("workspace_id", "user_id", "type", "ip_hash", "detail")
        values (${event.workspaceId}, ${event.userId}, ${event.type}, ${ipHash}, ${JSON.stringify(detail)}::jsonb)`,
  );
}
