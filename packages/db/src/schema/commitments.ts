import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";
import { categories } from "./categories.js";
import { commitmentKindEnum, directionEnum, rhythmEnum } from "./enums.js";
import { workspaces } from "./workspaces.js";

/**
 * A standing income or expense, per data-model.md. Not a payment: the amount
 * actually charged lives in `commitment_amounts`.
 *
 * `start_month` / `end_month` are stored generated columns derived from their
 * date, per the month-index convention verified in VQ-1
 * (`packages/db/scripts/verify-generated-columns.sql`).
 */
export const commitments = pgTable(
  "commitments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    direction: directionEnum("direction").notNull(),
    kind: commitmentKindEnum("kind").notNull().default("expense"),
    categoryId: uuid("category_id").notNull(),
    sourceAccountId: uuid("source_account_id").notNull(),
    transferAccountId: uuid("transfer_account_id"),
    sharePercent: smallint("share_percent").notNull().default(100),
    rhythm: rhythmEnum("rhythm").notNull(),
    /** Month index. Required unless `rhythm = 'monthly'`, FR-014. */
    anchorMonth: integer("anchor_month"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    startMonth: integer("start_month").generatedAlwaysAs(
      sql`(EXTRACT(YEAR FROM start_date)::int * 12 + EXTRACT(MONTH FROM start_date)::int - 1)`,
    ),
    endDate: date("end_date", { mode: "string" }),
    endMonth: integer("end_month").generatedAlwaysAs(
      sql`(EXTRACT(YEAR FROM end_date)::int * 12 + EXTRACT(MONTH FROM end_date)::int - 1)`,
    ),
    /** Cancellation notice date, FR-012. Displayed only. */
    noticeDeadline: date("notice_deadline", { mode: "string" }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    unique("commitments_workspace_id_id_key").on(table.workspaceId, table.id),

    foreignKey({
      name: "commitments_category_fk",
      columns: [table.workspaceId, table.categoryId],
      foreignColumns: [categories.workspaceId, categories.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "commitments_source_account_fk",
      columns: [table.workspaceId, table.sourceAccountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "commitments_transfer_account_fk",
      columns: [table.workspaceId, table.transferAccountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete("restrict"),

    // FR-014: anchor month required for every rhythm except monthly.
    check(
      "commitments_anchor_required",
      sql`${table.rhythm} = 'monthly' OR ${table.anchorMonth} IS NOT NULL`,
    ),
    // FR-016: a transfer to the source account is not a transfer.
    check(
      "commitments_transfer_not_source",
      sql`${table.transferAccountId} IS NULL OR ${table.transferAccountId} <> ${table.sourceAccountId}`,
    ),
    // FR-017: contract end cannot precede the start.
    check(
      "commitments_end_after_start",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check("commitments_share_percent_range", sql`${table.sharePercent} between 0 and 100`),
    check("commitments_name_length", sql`length(btrim(${table.name})) between 1 and 200`),

    index("commitments_workspace_category_idx").on(table.workspaceId, table.categoryId),
    index("commitments_workspace_source_account_idx").on(table.workspaceId, table.sourceAccountId),
    index("commitments_workspace_transfer_account_idx").on(
      table.workspaceId,
      table.transferAccountId,
    ),
    index("commitments_workspace_horizon_idx").on(
      table.workspaceId,
      table.startMonth,
      table.endMonth,
    ),
  ],
);

/** The charge history. An amount here is the charge actually made, never a smoothed figure. */
export const commitmentAmounts = pgTable(
  "commitment_amounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveMonth: integer("effective_month").generatedAlwaysAs(
      sql`(EXTRACT(YEAR FROM effective_from)::int * 12 + EXTRACT(MONTH FROM effective_from)::int - 1)`,
    ),
    /** FR-020 rejects a negative amount; zero is permitted (a paused contract needs no deletion). */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("commitment_amounts_workspace_id_id_key").on(table.workspaceId, table.id),
    // FR-024 and the edge case of two effective dates inside one month:
    // uniqueness is on the month, not the date.
    unique("commitment_amounts_commitment_id_effective_month_key").on(
      table.commitmentId,
      table.effectiveMonth,
    ),
    foreignKey({
      name: "commitment_amounts_commitment_fk",
      columns: [table.workspaceId, table.commitmentId],
      foreignColumns: [commitments.workspaceId, commitments.id],
    }).onDelete("cascade"),
    check("commitment_amounts_amount_non_negative", sql`${table.amountMinor} >= 0`),
    index("commitment_amounts_workspace_commitment_idx").on(table.workspaceId, table.commitmentId),
  ],
);

/** A one-month replacement of the amount in force, per FR-022/FR-023. */
export const amountOverrides = pgTable(
  "amount_overrides",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    month: integer("month").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    unique("amount_overrides_workspace_id_id_key").on(table.workspaceId, table.id),
    // Edge case: the same month overridden twice — a later write replaces
    // the earlier one via upsert on this constraint.
    unique("amount_overrides_commitment_id_month_key").on(table.commitmentId, table.month),
    foreignKey({
      name: "amount_overrides_commitment_fk",
      columns: [table.workspaceId, table.commitmentId],
      foreignColumns: [commitments.workspaceId, commitments.id],
    }).onDelete("cascade"),
    check("amount_overrides_amount_non_negative", sql`${table.amountMinor} >= 0`),
    index("amount_overrides_workspace_commitment_idx").on(table.workspaceId, table.commitmentId),
  ],
);
