import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Domain enums, per data-model.md. Declared ahead of the tables that use them
 * so they land in the first migration: `commitment_kind` and `rhythm` have no
 * consumer until T078, but an enum added later is a second migration against a
 * live type, and these are settled by the spec (FR-013, FR-018).
 */

/** FR-011: a commitment is an income or an expense. */
export const directionEnum = pgEnum("direction", ["income", "expense"]);

/** FR-018: money set aside is not money spent. */
export const commitmentKindEnum = pgEnum("commitment_kind", ["expense", "reserve"]);

/** FR-013: the supported payment rhythms. */
export const rhythmEnum = pgEnum("rhythm", [
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "one_off",
]);

/** FR-006: the security-relevant events the audit log records. */
export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "sign_in_succeeded",
  "sign_in_failed",
  "signed_out",
  "export_performed",
  "account_deleted",
  // Feature 002 (FR-015), migration 0007.
  "account_confirmed",
  "confirmation_resent",
  "confirmation_failed",
]);
