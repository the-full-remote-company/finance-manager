# Phase 1 Data Model: Email Verification for Registration

**Feature**: `002-email-verification` | **Date**: 2026-10-15

**Input**: [spec.md](./spec.md) Key Entities, [plan.md](./plan.md)

**Target**: PostgreSQL 17 via Drizzle ORM ([ADR 0001](../../decisions/0001-drizzle-as-orm.md))

---

## Conventions

All conventions from [feature 001's data-model.md](../001-recurring-budget-planner/data-model.md#conventions) apply:

- `uuid` primary keys via `gen_random_uuid()`
- Every tenant-scoped table carries `workspace_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy with both `USING` and `WITH CHECK`
- Cross-workspace foreign keys are composite, carrying `workspace_id`
- Genuine deletion (no soft-delete flags)
- `created_at timestamptz not null default now()` on every table

---

## Changes to existing tables

### `users` (modified)

**New columns**:

```sql
ALTER TABLE users
  ADD COLUMN confirmed boolean NOT NULL DEFAULT true,
  ADD COLUMN confirmed_at timestamptz;
```

**Migration data**: Every row existing before this migration is marked `confirmed = true` with `confirmed_at = now()` (FR-019). Only new registrations after this feature ships will create unconfirmed rows.

**Rationale**: `DEFAULT true` ensures existing accounts and the migration's own `UPDATE` produce confirmed rows. New registrations will explicitly set `confirmed = false`. `confirmed_at` is nullable because the migration sets it for existing rows, but new unconfirmed accounts have no timestamp until they confirm.

**No unique constraint change**: The existing `users_email_lower_key` unique index (`lower(email)`) is unchanged. A duplicate email is still rejected at registration regardless of confirmation state (ADR 0003 enumeration resistance).

---

## New tables

### `confirmation_tokens`

**Purpose**: One-time tokens for email confirmation. Only the SHA-256 hash is stored, following the session-token pattern in ADR 0003.

**Schema**:

```sql
CREATE TABLE confirmation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  superseded_at timestamptz,  -- set when a resend invalidates this token
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces (id) ON DELETE CASCADE,

  -- Composite FK enforcing same-workspace constraint (data-model.md convention)
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES users (workspace_id, id) ON DELETE CASCADE,

  UNIQUE (token_hash),
  UNIQUE (workspace_id, id)
);

CREATE INDEX confirmation_tokens_workspace_idx ON confirmation_tokens (workspace_id);
CREATE INDEX confirmation_tokens_user_idx ON confirmation_tokens (user_id);
CREATE INDEX confirmation_tokens_expires_idx ON confirmation_tokens (expires_at);

ALTER TABLE confirmation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmation_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY confirmation_tokens_tenant ON confirmation_tokens
  USING      (workspace_id = current_setting('app.workspace_id')::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
```

**Drizzle schema** (`packages/db/src/schema/confirmation-tokens.ts`):

```typescript
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./workspaces.js";
import { workspaces } from "./workspaces.js";

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
```

**Key fields**:

- **`token_hash`**: SHA-256 digest of the raw token (never the raw token itself). Unique across all workspaces.
- **`expires_at`**: 24 hours from issue (FR-003).
- **`superseded_at`**: Set when a resend is requested. A token with `superseded_at IS NOT NULL` is invalid even if not expired (FR-008).

**Validation logic**: A token is valid if and only if:
1. `token_hash` matches (after SHA-256 of the provided raw token)
2. `expires_at > now()`
3. `superseded_at IS NULL`
4. The referenced user has `confirmed = false` (a token for an already-confirmed user is useless)

**Cleanup**: Expired tokens are not automatically deleted. A future housekeeping task can delete tokens where `expires_at < now() - interval '30 days'` or `superseded_at < now() - interval '30 days'`. Out of scope for this feature.

---

## Entity relationship changes

```text
workspaces 1──n users
           1──n sessions
           1──n confirmation_tokens  (NEW)
           ...

users 1──n confirmation_tokens  (NEW)
```

**Referential integrity**:

- `confirmation_tokens.workspace_id` → `workspaces.id CASCADE`
- `confirmation_tokens (workspace_id, user_id)` → `users (workspace_id, id) CASCADE`

Deleting a user cascades to their confirmation tokens. Deleting a workspace cascades to everything.

---

## Tenant isolation verification

**Required test**: `packages/db/tests/isolation/confirmation-tokens.test.ts`

The test must:
1. Create workspace A with user A1 and an unconfirmed state, issue a confirmation token
2. Create workspace B with user B1
3. Bind a session to workspace B
4. Assert that workspace B can read/update/delete **zero** rows from `confirmation_tokens` where `workspace_id = A`
5. Assert that a direct `SELECT` by `id` or `token_hash` belonging to workspace A returns zero rows when scoped to B

This follows the cross-tenant leak test pattern from feature 001. No test, no merge.

---

## Migration file

**File**: `packages/db/migrations/00XX-add-email-confirmation.sql` (number assigned at write time)

**Contents**:

```sql
-- Add confirmation columns to users
ALTER TABLE users
  ADD COLUMN confirmed boolean NOT NULL DEFAULT true,
  ADD COLUMN confirmed_at timestamptz;

-- Grandfather existing accounts as confirmed (FR-019)
UPDATE users
  SET confirmed_at = now()
  WHERE confirmed_at IS NULL;

-- Create confirmation_tokens table
CREATE TABLE confirmation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (token_hash),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX confirmation_tokens_workspace_idx ON confirmation_tokens (workspace_id);
CREATE INDEX confirmation_tokens_user_idx ON confirmation_tokens (user_id);
CREATE INDEX confirmation_tokens_expires_idx ON confirmation_tokens (expires_at);

-- RLS policies
ALTER TABLE confirmation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmation_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY confirmation_tokens_tenant ON confirmation_tokens
  USING      (workspace_id = current_setting('app.workspace_id')::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);

-- Grant to app role (feature 001 pattern)
GRANT SELECT, INSERT, UPDATE, DELETE ON confirmation_tokens TO app;
```

**Rollback** (if needed):

```sql
DROP TABLE confirmation_tokens;
ALTER TABLE users DROP COLUMN confirmed, DROP COLUMN confirmed_at;
```

---

## Summary

- **Modified**: `users` gains `confirmed` and `confirmed_at`
- **New**: `confirmation_tokens` (tenant-scoped, hashed tokens, expires_at + superseded_at)
- **Isolation**: Cross-tenant leak test required
- **Migration**: Grandfathers existing users as confirmed

No changes to `sessions`, `workspaces`, or any other table.
