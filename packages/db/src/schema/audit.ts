import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditEventTypeEnum } from "./enums.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Append-only, per Article VIII. Enforced by grant in the migration
 * (`REVOKE UPDATE, DELETE ON audit_events FROM app`), not by convention.
 *
 * `workspace_id` and `user_id` are nullable and are deliberately NOT foreign
 * keys: the record must survive erasure of the user it refers to, and at
 * deletion time both are set to null so the retained row carries no personal
 * data. This is the only place in the schema where a reference is
 * intentionally not a foreign key — recorded in data-model.md so it is not
 * "fixed" later.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id"),
    userId: uuid("user_id"),
    type: auditEventTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** A hash, never an address (Article VIII). */
    ipHash: bytea("ip_hash"),
    /**
     * MUST NOT contain an email address, an account name, or any monetary
     * amount. A test asserts the shape each event type writes.
     */
    detail: jsonb("detail").notNull().default({}).$type<Record<string, unknown>>(),
  },
  (table) => [index("audit_events_workspace_idx").on(table.workspaceId, table.occurredAt)],
);

/**
 * Throttling state for FR-005. Consulted before any workspace is known, so it
 * carries no `workspace_id` and no RLS policy. Its exemption is explicit and
 * tested: the isolation suite asserts the set of tables without a policy is
 * exactly {auth_attempts, fx_rates}, so a future table cannot join that set
 * silently.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Hash of the submitted email, never the address itself. */
    identifierHash: bytea("identifier_hash").notNull(),
    ipHash: bytea("ip_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    unique("auth_attempts_window_key").on(table.identifierHash, table.ipHash, table.windowStart),
  ],
);
