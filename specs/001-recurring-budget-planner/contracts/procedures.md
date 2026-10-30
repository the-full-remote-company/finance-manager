# Procedure Contracts

**Feature**: `001-recurring-budget-planner`

Conventions in [README.md](./README.md). Error codes in [errors.md](./errors.md).
`Money`, `Month`, `Date` and `Percentage` refer to the wire types defined there.

Each procedure lists the requirements it implements, so a missing procedure is
visible as an uncovered requirement rather than discovered during
implementation.

---

## `auth`

### `auth.register` — mutation, unauthenticated

Creates the user *and* their workspace in one transaction, per FR-001.

```text
in   { email: string(email), password: string(min 12), displayName: string(1..120) }
out  { userId: uuid, workspaceId: uuid }
```

- Password minimum 12 characters. No composition rules; length is the control
  that matters and argon2id does the rest, per ADR 0003.
- **Superseded by feature 002**: registration no longer sets a session cookie.
  The account is created unconfirmed, a confirmation link is emailed, and a
  session exists only after `auth.confirm`. See
  [002 procedures](../../002-email-verification/contracts/procedures.md).
- Response does not reveal whether the address was already registered, per ADR
  0003. A collision returns the same shape and timing class as success, sends
  no mail and creates nothing.
- Appends nothing to `audit_events`; registration is not in FR-006's list.

Errors: `VALIDATION_FAILED`, `RATE_LIMITED`.

Implements FR-001, FR-002.

### `auth.signIn` — mutation, unauthenticated

```text
in   { email: string(email), password: string }
out  { workspaceId: uuid }
```

- Sets the `__Host-session` cookie on success. Feature 002 adds
  `ACCOUNT_NOT_CONFIRMED`, returned only after the password verified.
- A wrong password, an unknown address and a throttled attempt return the
  identical `AUTH_FAILED` error, per FR-005 and ADR 0003.
- Appends `sign_in_succeeded` or `sign_in_failed` to `audit_events`, per FR-006.

Errors: `AUTH_FAILED`, `RATE_LIMITED`, `VALIDATION_FAILED`.

Implements FR-004, FR-005, FR-006.

### `auth.signOut` — mutation

```text
in   {}
out  { ok: true }
```

- Deletes the session row and clears the cookie.
- Appends `signed_out`.
- The client MUST then purge every cache and the persisted query store, per
  FR-035e and ADR 0006. The server cannot do this, so it is asserted by an
  end-to-end test rather than trusted.

Errors: none beyond transport.

Implements FR-035e, FR-006.

### `auth.session` — query

```text
in   {}
out  { userId: uuid, workspaceId: uuid, displayName: string, locale: string } | null
```

Returns `null` rather than erroring when unauthenticated, so the client can
decide between a sign-in screen and a redirect without treating the absence of
a session as a failure.

Implements FR-004.

---

## `accounts`

### `accounts.list` — query

```text
in   {}
out  Array<{ id: uuid, name: string, note: string | null, sortOrder: int }>
```

Ordered by `sortOrder`. Implements FR-007.

### `accounts.create` — mutation

```text
in   { name: string(1..120), note?: string(max 2000) }
out  { id: uuid }
```

Errors: `VALIDATION_FAILED`, `NAME_TAKEN`. Implements FR-007.

### `accounts.rename` — mutation

```text
in   { id: uuid, name: string(1..120), note?: string | null }
out  { ok: true }
```

Succeeds while the account is referenced, per FR-009a. The reference is by
identifier, so no commitment is affected.

Errors: `NOT_FOUND`, `VALIDATION_FAILED`, `NAME_TAKEN`. Implements FR-007, FR-009a.

### `accounts.reorder` — mutation

```text
in   { ids: uuid[] }   // the complete set, in the desired order
out  { ok: true }
```

The full set is required rather than a pair of positions, so the resulting order
is unambiguous and one request cannot leave gaps.

Errors: `NOT_FOUND`, `VALIDATION_FAILED`. Implements FR-007.

### `accounts.delete` — mutation

```text
in   { id: uuid }
out  { ok: true }
```

Refused while referenced as a source account **or** as a transfer destination.
The error carries the count, summed across both reference kinds, per FR-009 and
its edge case.

Errors: `NOT_FOUND`, `STILL_REFERENCED { referenceCount: int }`. Implements FR-009.

### `accounts.referenceCount` — query

```text
in   { id: uuid }
out  { asSource: int, asTransferDestination: int, total: int }
```

Lets the UI warn before the user attempts a deletion that will be refused.
Implements FR-009.

---

## `categories`

`list`, `create`, `rename`, `reorder`, `delete`, `referenceCount` mirror
`accounts` exactly, with two differences:

- `create` and `list` carry `direction: 'income' | 'expense'`, per FR-008.
- `referenceCount` returns `{ total: int }` only; a category has one reference
  kind.

`direction` is **immutable** after creation. Changing it would silently move
every referencing commitment between the income and expense totals, and the
commitment's own `direction` must agree with it (see
[data-model.md](../data-model.md)). The user deletes and recreates, which the
reference check makes a deliberate act. `DIRECTION_IMMUTABLE` is returned if
attempted.

Implements FR-008, FR-009, FR-009a.

---

## `commitments`

### `commitments.list` — query

```text
in   { categoryId?: uuid, direction?: Direction, kind?: CommitmentKind }
out  Array<CommitmentSummary>

CommitmentSummary {
  id: uuid, name: string, direction: Direction, kind: CommitmentKind,
  categoryId: uuid, categoryName: string,
  sourceAccountId: uuid, sourceAccountName: string,
  transferAccountId: uuid | null, transferAccountName: string | null,
  sharePercent: int, rhythm: Rhythm, anchorMonth: Month | null,
  startDate: Date, endDate: Date | null, noticeDeadline: Date | null,
  description: string | null,
  currentAmount: Money            // the amount in force in the current month
}
```

`noticeDeadline` and `description` are included in the list payload so
acceptance scenarios 4 and 6 of Story 7 — both deadline and description visible
without opening the record — are satisfiable without a second request.

Implements FR-010, FR-012.

### `commitments.get` — query

```text
in   { id: uuid }
out  CommitmentSummary & {
       amounts:   Array<{ id: uuid, effectiveFrom: Date, amount: Money }>,
       overrides: Array<{ id: uuid, month: Month, amount: Money }>,
       dueMonths: Month[]        // within the current horizon
     }
```

`dueMonths` is returned so the override form can restrict the user to months
that have a charge to replace, which is what makes OQ-1's rejection rule
discoverable rather than a surprise error.

Errors: `NOT_FOUND`. Implements FR-010.

### `commitments.create` — mutation

```text
in   {
       name: string(1..200),
       direction: Direction,
       kind: CommitmentKind,                 // default 'expense'
       categoryId: uuid,
       sourceAccountId: uuid,
       transferAccountId?: uuid | null,
       sharePercent?: int(0..100),           // default 100
       rhythm: Rhythm,
       anchorMonth?: Month,                  // required unless rhythm='monthly'
       startDate: Date,
       endDate?: Date | null,
       noticeDeadline?: Date | null,
       description?: string(max 2000) | null,
       initialAmount: Money                  // effective from startDate
     }
out  { id: uuid }
```

Validated in one transaction, with the error code naming the rule broken:

| Rule | Error | Requirement |
|---|---|---|
| Anchor month absent for a non-monthly rhythm | `ANCHOR_REQUIRED` | FR-014 |
| Transfer destination equals source account | `TRANSFER_EQUALS_SOURCE` | FR-016 |
| Contract end date before start date | `END_BEFORE_START` | FR-017 |
| Amount negative | `NEGATIVE_AMOUNT` | FR-020 |
| Direction disagrees with the category's direction | `DIRECTION_MISMATCH` | FR-011 |
| Category or account belongs to another workspace | `NOT_FOUND` | FR-003 |

`initialAmount` is mandatory, because FR-011 requires at least one amount and a
commitment with none would have no figure in its first active month. An amount
of zero is accepted, so a paused contract needs no deletion.

Errors: the table above, plus `VALIDATION_FAILED`, `RATE_LIMITED`.

Implements FR-010 – FR-020.

### `commitments.update` — mutation

```text
in   { id: uuid } & Partial<create input, excluding initialAmount>
out  { ok: true }
```

Amounts are never changed here — that is `amounts.*`, so that editing a
commitment cannot silently rewrite history, which is Story 8's entire premise.

Errors: as `create`, plus `NOT_FOUND`. Implements FR-010.

### `commitments.delete` — mutation

```text
in   { id: uuid }
out  { ok: true }
```

Cascades to its amounts and overrides. The commitment disappears from every
month in the horizon, including past months, per Story 2 scenario 5.

Errors: `NOT_FOUND`. Implements FR-010.

---

## `amounts`

### `amounts.add` — mutation

```text
in   { commitmentId: uuid, effectiveFrom: Date, amount: Money }
out  { id: uuid }
```

| Rule | Error | Requirement |
|---|---|---|
| An amount already exists in that calendar month | `EFFECTIVE_MONTH_TAKEN` | FR-024, edge case |
| Amount negative | `NEGATIVE_AMOUNT` | FR-020 |

Only the month of `effectiveFrom` is significant; the amount is in force from
that whole month onward, per FR-026b.

Implements FR-021, FR-024, FR-026b.

### `amounts.update` — mutation

```text
in   { id: uuid, effectiveFrom?: Date, amount?: Money }
out  { ok: true }
```

Errors: `NOT_FOUND`, `EFFECTIVE_MONTH_TAKEN`, `NEGATIVE_AMOUNT`.

### `amounts.remove` — mutation

```text
in   { id: uuid }
out  { ok: true }
```

Refused when it is the only amount, or when removing it would leave the
commitment's earliest active months with no amount in force.

Errors: `NOT_FOUND`, `LAST_AMOUNT`, `AMOUNT_GAP`. Implements FR-011.

---

## `overrides`

### `overrides.set` — mutation

```text
in   { commitmentId: uuid, month: Month, amount: Money }
out  { id: uuid }
```

Upsert on `(commitmentId, month)`, so a second override of a month replaces the
first and no duplicate can exist, per the edge case.

| Rule | Error | Requirement |
|---|---|---|
| Month outside the commitment's active window | `MONTH_NOT_ACTIVE` | FR-024 |
| Month is not a due month of the commitment | `MONTH_NOT_DUE` | FR-024, OQ-1 |
| Amount negative | `NEGATIVE_AMOUNT` | FR-020 |

`MONTH_NOT_DUE` is the open interpretation OQ-1: an override replaces a charge,
and a non-due month of a non-monthly commitment has no charge. For a monthly
commitment every active month is a due month, so the rule is invisible there.

Implements FR-022, FR-024.

### `overrides.remove` — mutation

```text
in   { id: uuid }
out  { ok: true }
```

The month reverts to the amount in force. Errors: `NOT_FOUND`. Implements FR-023.

---

## `dashboard`

### `dashboard.horizon` — query

```text
out  { firstMonth: Month, lastMonth: Month, currentMonth: Month }
```

The rolling 24-month window, relative to the current month. The client uses it
to stop navigation at the boundary with a clear indication rather than an empty
screen, per FR-025 and its edge case.

Implements FR-025.

### `dashboard.month` — query

```text
in   { month: Month, presentation: 'smoothed' | 'cash' }
out  {
       month: Month,
       presentation: Presentation,
       currency: string,
       income: {
         total: Money,
         lines: Array<{ commitmentId: uuid, name: string,
                        categoryId: uuid, amount: Money }>
       },
       expenseCategories: Array<{
         categoryId: uuid, name: string, total: Money,
         percentOfIncome: Percentage,           // null when income is zero
         lines: Array<{ commitmentId: uuid, name: string,
                        amount: Money, isDue: boolean }>
       }>,
       expenseTotal: Money,
       reservesTotal: Money,
       reserveCategories: Array<same shape as expenseCategories>,
       combinedTotal: Money,                    // expenseTotal + reservesTotal
       remaining: Money,                        // income.total - combinedTotal
       retrievedAt: string(ISO 8601)
     }
```

- Reserve commitments appear only under `reserveCategories` and only in
  `reservesTotal`, never in `expenseCategories` or `expenseTotal`, per FR-032. A
  category holding both kinds appears in both lists with the matching subset of
  lines, which is Story 5 scenario 2.
- `expenseTotal + reservesTotal == combinedTotal == the sum of all outgoing
  commitments for the month`, per Story 5 scenario 3. Asserted by a test, not
  merely intended.
- `percentOfIncome` is `null` — not `0`, not an error — when `income.total` is
  zero, per FR-033.
- A category with no active commitment in the month is **omitted** from the
  arrays. Story 3 scenario 5 permits either omission or zero provided it is
  consistent; omission is chosen and applied uniformly.
- `remaining` may be negative. It is the one signed figure in the payload, and
  FR-043 requires the client to convey its sign by more than colour.
- `retrievedAt` is the server's timestamp and is what the service worker
  mirrors into `x-cached-at`, giving FR-035b its "when they were retrieved"
  without the client guessing.
- Presentation is a parameter, not server state. FR-030's persistence across
  navigation and sessions is client-side, so a shared cache entry cannot be
  poisoned by another device's preference.

Errors: `MONTH_OUT_OF_HORIZON`, `VALIDATION_FAILED`.

Implements FR-025, FR-027, FR-028, FR-028a, FR-028b, FR-029, FR-031 – FR-034.

---

## `transfers`

### `transfers.month` — query

```text
in   { month: Month }
out  {
       month: Month,
       currency: string,
       destinations: Array<{
         accountId: uuid, accountName: string,
         total: Money,                 // exactly the sum of the lines below
         lines: Array<{ commitmentId: uuid, name: string,
                        sourceAccountId: uuid, sourceAccountName: string,
                        sharePercent: int,
                        fullAmount: Money,      // the charge
                        amount: Money }>        // share applied, rounded half-up
       }>,
       retrievedAt: string(ISO 8601)
     }
```

- No `presentation` parameter. Transfers are always computed from the cash view,
  per OQ-2 in [research.md](../research.md): a transfer instructs the user to
  move money that is actually leaving an account this month, and a smoothed
  figure would instruct them to move money not yet due.
- `amount` is `applyShare(fullAmount, sharePercent)` — half-up, in minor units,
  at the point the share is applied, per FR-039 and FR-039a.
- `total` is the plain sum of the `lines[].amount` values above it. It may
  therefore exceed the exact mathematical total when several lines round up;
  this is accepted by the spec's edge case, because every displayed line must be
  transferable. FR-039b's "no reconciling difference" is asserted by a test over
  the response itself.
- A commitment with no transfer destination never appears, per FR-038. A
  commitment with `sharePercent = 0` appears with `amount` zero, per the edge
  case requiring it to contribute nothing here while still counting in category
  totals.
- `destinations` is empty for a month in which nothing is routed; the client
  renders an explanatory empty state, per Story 6 scenario 5.

Errors: `MONTH_OUT_OF_HORIZON`, `VALIDATION_FAILED`.

Implements FR-036 – FR-039b.

---

## `dataRights`

### `dataRights.export` — query

```text
in   {}
out  {
       exportedAt: string(ISO 8601),
       schemaVersion: 1,
       workspace: {...},
       users: [...],            // without password_hash or session data
       accounts: [...],
       categories: [...],
       commitments: [...],
       commitmentAmounts: [...],
       amountOverrides: [...],
       auditEvents: [...]
     }
```

Every field of every record the workspace holds, per FR-040 and SC-008, which
requires a field-by-field comparison against a populated workspace. A new column
added to any table without appearing here fails that test, which is how the
export stays complete.

`password_hash` is excluded: it is a credential, not the user's data, and
disclosing it would weaken the credential without serving Article 15.

Appends `export_performed` to `audit_events`, per FR-006.

A query rather than a mutation, so it is a `GET`. Deliberately **excluded** from
service-worker caching by path, since a cached copy of the entire workspace is
precisely the personal data ADR 0006's purge exists to remove.

Implements FR-040, FR-006.

### `dataRights.deleteAccount` — mutation

```text
in   { password: string, confirmation: 'DELETE' }
out  { ok: true }
```

- Re-authentication is required; a session alone is not sufficient to destroy
  every record.
- Deletes the workspace row in one transaction, cascading to every tenant-scoped
  table. No soft delete, per Article VIII.
- Appends `account_deleted` **with `workspace_id` and `user_id` set to `null`**,
  so the retained audit record carries no personal data, as explained in
  [data-model.md](../data-model.md).
- Clears the cookie; the client purges all caches, per FR-035e.
- Afterwards, every previously valid identifier returns `NOT_FOUND`, per Story 9
  scenario 3 and SC-009.

Errors: `AUTH_FAILED`, `VALIDATION_FAILED`, `RATE_LIMITED`.

Implements FR-041, FR-006, FR-035e.

---

## `health`

### `health.ping` — query, unauthenticated

```text
out  { ok: true, time: string(ISO 8601) }
```

Used by the client to distinguish "offline" from "server unreachable", and by
the container health check. Never cached by the service worker — a cached
`health.ping` would report a live server to an offline client, which is the
single worst thing to lie about in a read-only-offline design.
