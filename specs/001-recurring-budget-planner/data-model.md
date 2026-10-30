# Phase 1 Data Model: Recurring Budget Planner

**Feature**: `001-recurring-budget-planner` | **Date**: 2026-09-15

**Input**: [spec.md](./spec.md) Key Entities, [research.md](./research.md) Part B

**Target**: PostgreSQL 17 via Drizzle ORM ([ADR 0001](../../decisions/0001-drizzle-as-orm.md))

---

## Conventions

These apply to every table below and are not repeated per table.

**Identifiers**. `uuid` primary keys, generated with `gen_random_uuid()` from
`pgcrypto`. Sequential integers would leak record counts across the tenant
boundary via URL, which Article I's non-disclosure requirement rules out.

**Tenancy**. Every tenant-scoped table carries `workspace_id uuid not null`
referencing `workspaces(id) on delete cascade`. Per Article I each of them has:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_tenant ON <t>
  USING      (workspace_id = current_setting('app.workspace_id')::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id')::uuid);
```

`USING` alone would permit inserting a row into another workspace, so
`WITH CHECK` is mandatory, not decorative. The application connects as role
`app`, which owns no table and is not a superuser, because RLS does not apply to
an owner or a superuser. Every request runs inside one transaction that begins
with `SET LOCAL app.workspace_id = $1`.

**Cross-workspace foreign keys**. A foreign key alone cannot prevent a
commitment in workspace A pointing at a category in workspace B, because the
reference target is only checked for existence. Every intra-tenant reference is
therefore a composite foreign key that carries `workspace_id`, which makes the
mismatch unrepresentable:

```sql
FOREIGN KEY (workspace_id, category_id)
  REFERENCES categories (workspace_id, id) ON DELETE RESTRICT
```

This requires a `unique (workspace_id, id)` on every referenced table.

**Money**. `bigint` minor units plus `currency char(3)`, per Article II. No
`numeric`, no `real`, no `double precision` anywhere in this schema. Every
amount column is accompanied by its currency column; a bare amount does not
exist.

**Month index**. A month is the integer `year * 12 + (month - 1)`. Dates are
stored day-precise where the spec needs them (`date`), and each is paired with a
stored generated column holding its month index, so projection filters and
uniqueness constraints operate at month granularity per FR-026 and FR-026b:

```sql
start_month integer GENERATED ALWAYS AS
  (EXTRACT(YEAR FROM start_date)::int * 12
   + EXTRACT(MONTH FROM start_date)::int - 1) STORED
```

> **VQ-1 — VERIFIED 2026-09-15, PostgreSQL 17-alpine. PASS.**
> `EXTRACT(... FROM <date>)` is accepted inside `GENERATED ALWAYS AS ... STORED`;
> the computed indices are correct across a year boundary (1999-12 → 23999,
> 2026-01 → 24312, 2026-03 → 24314); `NULL` propagates from a nullable date to
> its month column; and the generated column is indexable, which FR-024's
> `unique (commitment_id, effective_month)` requires. Executed by
> `pnpm db:verify:generated-columns`
> (`packages/db/scripts/verify-generated-columns.sql`), which is kept in the
> repository so the answer is re-proved rather than remembered.
>
> The fallback is therefore **not** taken. Had it failed, the month index would
> have become a plain `integer not null` column derived in `packages/core` with
> `CHECK (start_month = <expression>)`, a check constraint having no
> immutability requirement; the schema shape and every constraint below would
> have been unchanged either way.

**Timestamps**. `created_at timestamptz not null default now()` on every table,
`updated_at timestamptz` where a record is mutable.

**Deletion**. Genuine deletion, per Article VIII. There is no `deleted_at`, no
`is_active`, no soft-delete flag in this schema, and adding one requires an ADR.

---

## Entity relationship overview

```text
workspaces 1──n users
           1──n sessions
           1──n accounts
           1──n categories
           1──n commitments
           1──n audit_events

commitments n──1 categories            (RESTRICT)
            n──1 accounts  source      (RESTRICT)
            n──0..1 accounts  transfer destination (RESTRICT)
            1──n commitment_amounts    (CASCADE)
            1──n amount_overrides      (CASCADE)

not tenant-scoped: auth_attempts, fx_rates
```

`ON DELETE RESTRICT` on the three account and category references is what
implements FR-009. `ON DELETE CASCADE` from a commitment to its amounts and
overrides implements the "delete a commitment and it vanishes from every month"
scenario of Story 2.

---

## Tables

### `workspaces`

The isolation boundary. Owns everything else.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text not null` | Household name. Defaults to the registering user's display name. |
| `created_at` | `timestamptz not null` | |

RLS policy is on `id` rather than a `workspace_id` column:
`USING (id = current_setting('app.workspace_id')::uuid)`. Deleting this row
cascades to every tenant-scoped table, which is the mechanism behind FR-041 and
SC-009.

Satisfies FR-001, FR-002.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. One member per workspace this release. |
| `email` | `citext not null` | `unique` **globally**, not per workspace — an address identifies one account. |
| `password_hash` | `text not null` | argon2id, [ADR 0003](../../decisions/0003-hand-rolled-sessions.md). Never leaves `packages/auth`. |
| `display_name` | `text not null` | |
| `locale` | `text not null default 'de-DE'` | |
| `created_at` | `timestamptz not null` | |

The global unique index on `email` is deliberately outside the tenant boundary
and is the one intentional cross-tenant signal in the schema: registration can
determine that an address is taken. Per ADR 0003 the *response* does not reveal
it. Documented here so a reader does not read it as an oversight.

`citext` requires the `citext` extension. It is a core contrib module, not
provider-specific, so ADR 0002's "standard PostgreSQL only" constraint holds;
the alternative is `text` with a unique index on `lower(email)`, which is
equivalent and requires no extension. Decide at migration time; noted as VQ-2.

Satisfies FR-001, FR-004.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `user_id` | `uuid not null` | Composite FK `(workspace_id, user_id)`, cascade. |
| `token_hash` | `bytea not null` | `unique`. SHA-256 of the session token. The token itself is never stored. |
| `expires_at` | `timestamptz not null` | Absolute, 30 days. |
| `last_seen_at` | `timestamptz not null` | Drives sliding renewal. |
| `created_at` | `timestamptz not null` | |

Session lookup happens **before** a workspace is known, so the verify query runs
outside the tenant transaction as a dedicated role restricted to this table, and
its result establishes the `app.workspace_id` for everything that follows. This
is the one read that cannot be RLS-scoped by construction; it is called out here
so the isolation test suite covers it explicitly rather than skipping it.

Satisfies FR-004.

### `accounts`

A label for a place money sits. No balance, no bank identifier — per the spec's
assumptions, so nothing here needs encryption-readiness under Article VIII.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `name` | `text not null` | `check (length(btrim(name)) between 1 and 120)` |
| `note` | `text` | Optional. |
| `sort_order` | `integer not null` | User-defined order, FR-007. |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `unique (workspace_id, id)` for composite references;
`unique (workspace_id, name)` so two accounts cannot share a name.

Satisfies FR-007. Deletion refusal is the `RESTRICT` on the two references from
`commitments`, plus a count query that reports *both* reference kinds, per the
edge case "an account is deleted while referenced as a source or as a transfer
destination → both reference kinds count toward the reported total".

### `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `name` | `text not null` | `check (length(btrim(name)) between 1 and 120)` |
| `direction` | `direction not null` | Enum `('income','expense')`. Single level, no nesting. |
| `sort_order` | `integer not null` | FR-008. |
| `created_at`, `updated_at` | `timestamptz` | |

Constraints: `unique (workspace_id, id)`; `unique (workspace_id, name)`.

Satisfies FR-008. FR-009a (rename while referenced) needs no mechanism — the
reference is by `id`, so a rename is invisible to it. That is worth stating
because it is the reason the spec could grant free renaming at all.

### `commitments`

A standing income or expense. Not a payment.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `name` | `text not null` | `check (length(btrim(name)) between 1 and 200)` |
| `direction` | `direction not null` | `('income','expense')`, FR-011. |
| `kind` | `commitment_kind not null default 'expense'` | `('expense','reserve')`, FR-018. |
| `category_id` | `uuid not null` | Composite FK, `RESTRICT`. |
| `source_account_id` | `uuid not null` | Composite FK, `RESTRICT`. |
| `transfer_account_id` | `uuid` | Optional. Composite FK, `RESTRICT`. FR-012. |
| `share_percent` | `smallint not null default 100` | `check (share_percent between 0 and 100)`, FR-015. |
| `rhythm` | `rhythm not null` | `('monthly','quarterly','half_yearly','yearly','one_off')`, FR-013. |
| `anchor_month` | `integer` | Month index. Required unless monthly, FR-014. |
| `start_date` | `date not null` | FR-011. |
| `start_month` | `integer` generated | See month-index convention. |
| `end_date` | `date` | Contract end, FR-012. |
| `end_month` | `integer` generated | Null when `end_date` is null. |
| `notice_deadline` | `date` | Cancellation notice, FR-012. Displayed only — notifications are out of scope. |
| `description` | `text` | Free text, FR-012. |
| `created_at`, `updated_at` | `timestamptz` | |

Table constraints, each carrying the requirement it implements:

```sql
-- FR-014: anchor month required for every rhythm except monthly
CHECK (rhythm = 'monthly' OR anchor_month IS NOT NULL)

-- FR-016: a transfer to the source account is not a transfer
CHECK (transfer_account_id IS NULL OR transfer_account_id <> source_account_id)

-- FR-017: contract end cannot precede the start
CHECK (end_date IS NULL OR end_date >= start_date)

UNIQUE (workspace_id, id)
```

`anchor_month` is deliberately *not* constrained to be at or after
`start_month`. Per research B3 an anchor is a phase marker, and an anchor before
the start date is legal — it yields no due month until the first occurrence on
or after the start month, which is exactly the edge case "a commitment's start
date falls after its anchor month".

For `rhythm = 'one_off'`, `anchor_month` is the single month in which the
commitment falls due, per FR-014 read together with FR-013.

Indexes: `(workspace_id, category_id)`, `(workspace_id, source_account_id)`,
`(workspace_id, transfer_account_id)` — the first two serve dashboard grouping,
all three serve the FR-009 reference count. `(workspace_id, start_month, end_month)`
serves horizon filtering.

**Direction and category agreement.** A commitment's `direction` and its
category's `direction` must agree; an income commitment inside an expense
category would make the dashboard's income total and category totals
inconsistent. The database cannot express this as a `CHECK` across tables
without a trigger, and Article VI forbids business rules in triggers.
Consequence: it is validated in `packages/core` at the trust boundary and
covered by an integration test. Recorded because a reader will otherwise look
for the constraint.

Satisfies FR-010 through FR-018.

### `commitment_amounts`

The charge history. An amount here is the charge actually made, never a smoothed
figure.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `commitment_id` | `uuid not null` | Composite FK, **cascade**. |
| `effective_from` | `date not null` | FR-021. |
| `effective_month` | `integer` generated | FR-026b: in force from that whole month onward. |
| `amount_minor` | `bigint not null` | `check (amount_minor >= 0)` — FR-020 rejects negatives; zero is permitted so a paused contract needs no deletion. |
| `currency` | `char(3) not null default 'EUR'` | Article II. |
| `created_at` | `timestamptz not null` | |

```sql
-- FR-024 and the edge case of two effective dates inside one month
UNIQUE (commitment_id, effective_month)
```

Uniqueness is on the *month*, not the date, which rejects both a duplicate
effective date and two different days within the same month in one constraint.

Application-level invariant, not expressible as a table constraint: a commitment
must have at least one amount (FR-011), and the earliest `effective_month` must
be at or before the commitment's `start_month`, or the first active months would
have no amount in force. Both are enforced in the same transaction that creates
the commitment and covered by tests. Noted rather than hidden.

Satisfies FR-019, FR-020, FR-021, FR-024, FR-026b.

### `amount_overrides`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid not null` | Cascade. |
| `commitment_id` | `uuid not null` | Composite FK, **cascade**. |
| `month` | `integer not null` | Month index. |
| `amount_minor` | `bigint not null` | `check (amount_minor >= 0)` |
| `currency` | `char(3) not null default 'EUR'` | |
| `created_at`, `updated_at` | `timestamptz` | |

```sql
-- edge case: the same month overridden twice -> later write replaces earlier
UNIQUE (commitment_id, month)
```

Written as an upsert on that constraint, so a second override of a month
replaces the first and no duplicate can exist.

FR-024's "reject an override for a month in which the commitment is not active"
is a cross-row rule against the parent commitment's active window, validated in
`packages/core`. Per research B6/OQ-1 an override on a non-due month of a
non-monthly commitment is also rejected, because there is no charge in that
month to replace.

Satisfies FR-022, FR-023, FR-024.

### `audit_events`

Append-only, per Article VIII.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` | Nullable: a failed sign-in has no known workspace. |
| `user_id` | `uuid` | Nullable, and **not** a foreign key — the record must survive erasure of the user it refers to. |
| `type` | `audit_event_type not null` | `('sign_in_succeeded','sign_in_failed','signed_out','export_performed','account_deleted')`, FR-006. |
| `occurred_at` | `timestamptz not null` | |
| `ip_hash` | `bytea` | Hash, not address. |
| `detail` | `jsonb not null default '{}'` | |

Append-only is enforced by grant, not convention:

```sql
REVOKE UPDATE, DELETE ON audit_events FROM app;
```

`detail` MUST NOT contain an email address, an account name, or any monetary
amount, per Article VIII's logging prohibition. A test asserts the shape of what
each event type writes.

**Tension with Article VIII, resolved deliberately.** Erasure must be genuine,
yet the audit log must be append-only, and `account_deleted` is precisely the
event one would want to keep. Resolution: `workspace_id` is nullable with no
foreign key and is set to `null` for retained records at deletion time, and
`user_id` is likewise not a foreign key, so the surviving row carries no
personal data — only an event type, a timestamp, and a hashed IP. The workspace
cascade therefore does not need to reach this table, and nothing personal
survives it. This is the only place in the schema where a reference is
intentionally not a foreign key, and the reason is recorded here so it is not
"fixed" later.

Satisfies FR-006, and the Story 9 scenario requiring export and deletion to be
recorded.

### `auth_attempts` — not tenant-scoped

Throttling state for FR-005. Consulted before any workspace is known, so it
carries no `workspace_id` and no RLS policy.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `identifier_hash` | `bytea not null` | Hash of the submitted email. |
| `ip_hash` | `bytea not null` | |
| `window_start` | `timestamptz not null` | Fixed window. |
| `attempts` | `integer not null default 0` | |

`unique (identifier_hash, ip_hash, window_start)`. Rows older than the window
are pruned. Its exemption from RLS is explicit and tested — the isolation test
suite asserts the set of tables without a policy is exactly
`{auth_attempts, fx_rates}`, so a future table cannot join that set silently.

### `fx_rates` — not tenant-scoped

Required by Article II from the first migration that introduces money, even
though this release displays a single currency.

| Column | Type | Notes |
|---|---|---|
| `base_currency` | `char(3) not null` | |
| `quote_currency` | `char(3) not null` | |
| `rate_numerator` | `bigint not null` | Rational, not float — Article II. |
| `rate_denominator` | `bigint not null` | `check (rate_denominator > 0)` |
| `effective_from` | `date not null` | |

Primary key `(base_currency, quote_currency, effective_from)`. Seeded with
`EUR/EUR = 1/1`. No conversion logic exists in this release; the table exists so
a second currency is a data change rather than a migration across every table
that touches an amount.

---

## Enumerations

| Type | Values |
|---|---|
| `direction` | `income`, `expense` |
| `commitment_kind` | `expense`, `reserve` |
| `rhythm` | `monthly`, `quarterly`, `half_yearly`, `yearly`, `one_off` |
| `audit_event_type` | `sign_in_succeeded`, `sign_in_failed`, `signed_out`, `export_performed`, `account_deleted` |

Native PostgreSQL enums. Adding a value is an `ALTER TYPE` migration, which is
the desired friction: a new rhythm changes projection arithmetic and must not be
a one-line data change.

---

## Domain types in `packages/core`

Plain data only. No React, Next.js, tRPC, ORM, HTTP or database client, per
Article VI.

```text
YearMonth        { index: number }                 // year*12 + (month-1)
Money            { minor: bigint; currency: string }
Rhythm           'monthly'|'quarterly'|'half_yearly'|'yearly'|'one_off'
Direction        'income'|'expense'
CommitmentKind   'expense'|'reserve'
Presentation     'smoothed'|'cash'

Commitment       { id, name, direction, kind, categoryId, sourceAccountId,
                   transferAccountId?, sharePercent, rhythm, anchorMonth?,
                   startMonth, endMonth?, amounts: AmountRecord[],
                   overrides: OverrideRecord[] }
AmountRecord     { effectiveMonth: YearMonth; amount: Money }
OverrideRecord   { month: YearMonth; amount: Money }

MonthProjection  { month, lines: ProjectionLine[] }
ProjectionLine   { commitmentId, month, amount: Money, isDue: boolean }
Percentage       { numerator: bigint; denominator: bigint } | null
```

`Percentage` stays an exact rational and is rounded only by `Intl.NumberFormat`
in the presentation layer, per Article II and FR-033. `null` is the
zero-income case, which FR-033 requires to be suppressed rather than errored.

Pure functions, each built test-first per Article III:

| Function | Requirement |
|---|---|
| `monthOf(date)`, `addMonths`, `compareMonths` | FR-026, FR-026a, FR-026b |
| `isActive(commitment, month)` | FR-026 |
| `dueMonths(commitment, range)` | FR-013, FR-014, FR-029 |
| `periodWindow(commitment, month)` | FR-027 |
| `allocate(totalMinor, parts)` | FR-028, SC-002, Article II |
| `amountInForce(commitment, dueMonth)` | FR-021, FR-022, FR-026b |
| `projectMonth(commitments, month, presentation)` | FR-027, FR-028a, FR-028b |
| `applyShare(amountMinor, sharePercent)` | FR-039, FR-039a |
| `transfersForMonth(commitments, month)` | FR-036, FR-037, FR-038, FR-039b |
| `dashboardForMonth(...)` | FR-031 through FR-034 |
| `horizon(today)` | FR-025 |

---

## Validation rules by requirement

Rules the database enforces:

| Rule | Mechanism | Requirement |
|---|---|---|
| Amounts are never negative | `CHECK (amount_minor >= 0)` | FR-020 |
| Share is 0–100, defaulting to 100 | `CHECK` + `DEFAULT 100` | FR-015 |
| Non-monthly rhythm needs an anchor | `CHECK` | FR-014 |
| Transfer destination differs from source | `CHECK` | FR-016 |
| Contract end not before start | `CHECK` | FR-017 |
| One amount per commitment per month | `UNIQUE (commitment_id, effective_month)` | FR-024 |
| One override per commitment per month | `UNIQUE (commitment_id, month)` | edge case |
| Referenced category or account cannot be deleted | `ON DELETE RESTRICT` | FR-009 |
| Cross-workspace references impossible | composite foreign keys | FR-002, FR-003 |
| No cross-tenant read, write or delete | RLS with `USING` and `WITH CHECK` | FR-003 |
| Audit log cannot be altered | `REVOKE UPDATE, DELETE` | FR-006 |
| Money is never floating point | `bigint` + `char(3)` only | FR-019, Article II |

Rules `packages/core` enforces, because they span rows or tables and Article VI
forbids putting them in a trigger:

| Rule | Requirement |
|---|---|
| Commitment direction agrees with its category's direction | FR-011, FR-031 |
| A commitment has at least one amount, effective at or before its start month | FR-011 |
| An override's month falls inside the commitment's active window | FR-024 |
| An override's month is a due month of the commitment | FR-024, OQ-1 |
| A target month lies inside the rolling 24-month horizon | FR-025 |
| Reserve commitments are excluded from expense totals and included in reserves | FR-032 |
| Percentage of income is suppressed when income is zero | FR-033 |
| Smoothed shares over a full period sum exactly to the charge | FR-028 |
| A destination total equals the sum of its displayed lines | FR-039b |

---

## State transitions

Nothing in this model has a lifecycle state machine. A commitment is not
"active" or "ended" as stored state; activity is derived from `start_month`,
`end_month` and the month being viewed. That is the point of a forward-looking
planner — there is no notion of a payment having occurred, per the spec's
assumptions — and it is why editing an amount cannot rewrite history: history
lives in `commitment_amounts`, keyed by effective month.

The only lifecycle in the schema is the session: created on sign-in, renewed
when older than 24 hours, deleted on sign-out, absolutely expired after 30 days.

---

## Isolation test matrix (Article I)

One leak test per tenant-scoped table. Each asserts that a transaction bound to
workspace A reads zero rows, updates zero rows and deletes zero rows belonging
to workspace B, against real PostgreSQL, and additionally that inserting a row
carrying workspace B's identifier is rejected by `WITH CHECK`.

`workspaces`, `users`, `sessions`, `accounts`, `categories`, `commitments`,
`commitment_amounts`, `amount_overrides`, `audit_events`.

Plus three tests that are not per-table:

1. The session verification read, which by necessity runs before a workspace is
   known (see `sessions` above), cannot return a session belonging to another
   workspace when given a token that does not match.
2. The set of tables without an RLS policy equals exactly
   `{auth_attempts, fx_rates}`, failing if any future table joins it.
3. The application role is neither a superuser nor the owner of any table,
   since RLS silently does not apply to either. Without this assertion every
   other leak test could pass vacuously.

Per Article I, none of these may be skipped, weakened or marked pending to make
CI pass.

---

## Open verification items

| Id | Item | Fallback |
|---|---|---|
| VQ-1 | `EXTRACT`-based generated month columns accepted as immutable by PostgreSQL 17 | Plain `integer` column derived in `core`, plus a `CHECK` constraint |
| VQ-2 | `citext` extension available, versus a unique index on `lower(email)` | The `lower(email)` index; no extension needed |

Both are settled by running the first migration against the container database.
Neither changes the schema's shape, so neither blocks Phase 1.
