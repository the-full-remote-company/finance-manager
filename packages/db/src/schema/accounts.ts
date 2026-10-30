import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

/**
 * A label for a place money sits, per data-model.md. No balance, no bank
 * identifier: an account is a label, and a column with no current consumer
 * must not be added speculatively (FR-007, Article VIII).
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    /** User-defined display order, FR-007. */
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // Composite target for commitments' source/transfer account references.
    unique("accounts_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("accounts_workspace_id_name_key").on(table.workspaceId, table.name),
    index("accounts_workspace_idx").on(table.workspaceId),
    check("accounts_name_length", sql`length(btrim(${table.name})) between 1 and 120`),
  ],
);
