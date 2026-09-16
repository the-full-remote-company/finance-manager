import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { directionEnum } from "./enums.js";
import { workspaces } from "./workspaces.js";

/**
 * A named grouping for commitments, per data-model.md. Single level, no
 * nesting. `direction` is immutable after creation at the application layer
 * (contracts/procedures.md): changing it would silently move every
 * referencing commitment between the income and expense totals.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    direction: directionEnum("direction").notNull(),
    /** User-defined display order, FR-008. */
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    unique("categories_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("categories_workspace_id_name_key").on(table.workspaceId, table.name),
    index("categories_workspace_idx").on(table.workspaceId),
    check("categories_name_length", sql`length(btrim(${table.name})) between 1 and 120`),
  ],
);
