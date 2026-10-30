import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * The isolation boundary. Owns everything else (data-model.md).
 *
 * Every tenant-scoped table below carries `workspace_id` and, in the migration,
 * ENABLE + FORCE ROW LEVEL SECURITY with a policy carrying both USING and
 * WITH CHECK. `USING` alone would permit inserting a row into another
 * workspace, so `WITH CHECK` is mandatory, not decorative (Article I).
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Household name. Defaults to the registering user's display name. */
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Case-insensitive uniqueness is enforced by the citext-free lower() index below. */
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    /** argon2id, per ADR 0003. Never logged, never exported. */
    passwordHash: text("password_hash").notNull(),
    /** Email confirmation state (feature 002). true means account can sign in. */
    confirmed: boolean("confirmed").notNull().default(true),
    /** Timestamp when account was confirmed (feature 002). null for unconfirmed accounts. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // Composite target for every intra-tenant reference (data-model.md).
    unique("users_workspace_id_id_key").on(table.workspaceId, table.id),
    index("users_workspace_idx").on(table.workspaceId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * SHA-256 of the opaque 128-bit token, per ADR 0003. The raw token never
     * reaches the database, so a database disclosure does not yield a usable
     * session.
     */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("sessions_token_hash_key").on(table.tokenHash),
    unique("sessions_workspace_id_id_key").on(table.workspaceId, table.id),
    index("sessions_workspace_idx").on(table.workspaceId),
    index("sessions_user_idx").on(table.userId),
  ],
);
