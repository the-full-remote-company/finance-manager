import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users, workspaces } from "./workspaces.js";

/**
 * Confirmation tokens for email verification (feature 002).
 * Only the SHA-256 hash is stored, following the session-token pattern in ADR 0003.
 * Raw tokens never reach the database, so a database disclosure does not yield a usable token.
 */
export const confirmationTokens = pgTable(
  "confirmation_tokens",
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
     * SHA-256 of the confirmation token, per ADR 0003 token pattern.
     * Raw token never reaches database.
     */
    tokenHash: text("token_hash").notNull(),
    /** Expires 24 hours from issue (FR-003). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * Set when a resend invalidates this token. A token with superseded_at
     * or expires_at in the past is invalid.
     */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("confirmation_tokens_token_hash_key").on(table.tokenHash),
    unique("confirmation_tokens_workspace_id_id_key").on(table.workspaceId, table.id),
    index("confirmation_tokens_workspace_idx").on(table.workspaceId),
    index("confirmation_tokens_user_idx").on(table.userId),
    index("confirmation_tokens_expires_idx").on(table.expiresAt),
  ],
);
