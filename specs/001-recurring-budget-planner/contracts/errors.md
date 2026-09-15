# Error Contract: Recurring Budget Planner

**Feature**: `001-recurring-budget-planner` | **Date**: 2026-09-15

**Input**: [procedures.md](./procedures.md), [spec.md](../spec.md),
[constitution v1.0.0](../../../.specify/memory/constitution.md)

Every failure this feature can produce, its wire shape, and what the client must
do with it. A procedure may only return a code listed here; adding a code is a
change to this document in the same commit, per Article VI's requirement that
the generated OpenAPI document stay complete.

---

## Wire shape

A tRPC error carries the machine code in `data.appCode` and the transport code in
`data.code`, so a Swift client reading the OpenAPI document sees the same
`appCode` string the TypeScript client does.

```json
{
  "error": {
    "message": "category_still_referenced",
    "data": {
      "code": "CONFLICT",
      "appCode": "STILL_REFERENCED",
      "details": { "referenceCount": 7 }
    }
  }
}
```

**`message` is never user-facing.** It is a stable machine token for logs. The UI
selects its string from `next-intl` by `appCode`, per the "Locale" rule that
hard-coded user-facing strings are a lint error. This is also why no error
carries a human sentence from the server: a server-authored sentence cannot be
translated by the client and cannot be a lint-enforced message key.

**`details` carries only what the UI needs to compose its message**, and never a
monetary amount, an account identifier, or any personal data, per Article VIII's
prohibition on writing those into logs and error payloads. `referenceCount` is a
count, not data.

**A record in another workspace produces `NOT_FOUND`**, byte-identical to a
record that never existed, including its `details` (absent) and its HTTP status.
Per FR-003 and Article I, non-existence and non-entitlement are indistinguishable
on the wire. A test asserts the two responses are equal, because a difference in
`message`, timing branch, or field order is a disclosure.

---

## Codes

| `appCode` | Transport | Details | Raised by |
|---|---|---|---|
| `VALIDATION_FAILED` | `BAD_REQUEST` | `{ path: string[] }` | Every procedure; Zod rejection at the boundary |
| `AUTH_FAILED` | `UNAUTHORIZED` | — | `auth.signIn`, `dataRights.deleteAccount` |
| `NOT_FOUND` | `NOT_FOUND` | — | Every procedure taking an identifier |
| `RATE_LIMITED` | `TOO_MANY_REQUESTS` | `{ retryAfterSeconds: int }` | `auth.*` and every mutation |
| `NAME_TAKEN` | `CONFLICT` | — | `accounts.create/rename`, `categories.create/rename` |
| `STILL_REFERENCED` | `CONFLICT` | `{ referenceCount: int }` | `accounts.delete`, `categories.delete` |
| `DIRECTION_IMMUTABLE` | `CONFLICT` | — | `categories.rename` (attempted direction change) |
| `DIRECTION_MISMATCH` | `BAD_REQUEST` | `{ categoryDirection: Direction }` | `commitments.create/update` |
| `ANCHOR_REQUIRED` | `BAD_REQUEST` | — | `commitments.create/update` |
| `TRANSFER_EQUALS_SOURCE` | `BAD_REQUEST` | — | `commitments.create/update` |
| `END_BEFORE_START` | `BAD_REQUEST` | — | `commitments.create/update` |
| `NEGATIVE_AMOUNT` | `BAD_REQUEST` | — | `commitments.create`, `amounts.add/update`, `overrides.set` |
| `EFFECTIVE_MONTH_TAKEN` | `CONFLICT` | `{ month: Month }` | `amounts.add/update` |
| `LAST_AMOUNT` | `CONFLICT` | — | `amounts.remove` |
| `AMOUNT_GAP` | `CONFLICT` | `{ firstUncoveredMonth: Month }` | `amounts.remove` |
| `MONTH_NOT_ACTIVE` | `BAD_REQUEST` | `{ activeFrom: Month, activeTo: Month \| null }` | `overrides.set` |
| `MONTH_NOT_DUE` | `BAD_REQUEST` | `{ dueMonths: Month[] }` | `overrides.set` |
| `MONTH_OUT_OF_HORIZON` | `BAD_REQUEST` | `{ firstMonth: Month, lastMonth: Month }` | `dashboard.month`, `transfers.month` |
| `OFFLINE_READ_ONLY` | — (client-generated) | — | Service worker, on any mutation while offline |

`OFFLINE_READ_ONLY` never originates on the server. It is synthesised by the
service worker so that a mutation attempted offline fails immediately with a
typed error instead of hanging until a transport timeout, per FR-035d and
[ADR 0006](../../../decisions/0006-offline-read-only-cache.md). It is listed here
because the client handles it on the same path as a server error, and because
listing it is what keeps "no offline write queue" a visible property of the
contract rather than an absence.

---

## Client handling

| `appCode` | UI behaviour | Requirement |
|---|---|---|
| `VALIDATION_FAILED` | Field-level message on `details.path`, focus moves to the first invalid field | Article IV (errors identified in text, not colour) |
| `AUTH_FAILED` | Generic "sign-in failed" — never distinguishes unknown user from wrong password | Story 1 scenario 4 |
| `NOT_FOUND` | Treated as "no longer exists"; list refetched, navigation returns to the dashboard | FR-003 |
| `RATE_LIMITED` | Submit disabled with a live countdown from `retryAfterSeconds`, announced via an ARIA live region | Story 1 scenario 4, Article IV |
| `NAME_TAKEN` | Inline on the name field | FR-007, FR-008 |
| `STILL_REFERENCED` | Blocking dialog stating the count and offering rename instead of delete | FR-009, clarification 2026-09-01 |
| `DIRECTION_IMMUTABLE` | Direction control disabled on edit with an explanation; the error is a backstop | FR-008 |
| `DIRECTION_MISMATCH` | Category or direction field flagged, with the category's own direction named | FR-011 |
| `ANCHOR_REQUIRED` | Anchor field revealed and flagged; it is hidden for `monthly` | FR-014 |
| `TRANSFER_EQUALS_SOURCE` | Inline on the destination field | FR-016 |
| `END_BEFORE_START` | Inline on the contract end date field | FR-017 |
| `NEGATIVE_AMOUNT` | Inline on the amount field | FR-020 |
| `EFFECTIVE_MONTH_TAKEN` | Offers to edit the existing amount for that month instead | FR-024 |
| `LAST_AMOUNT` | Explains a commitment must keep one amount; offers to delete the commitment | FR-011 |
| `AMOUNT_GAP` | Names the first month that would be left uncovered | FR-011 |
| `MONTH_NOT_ACTIVE` | Month picker restricted to the active window; the error is a backstop | FR-024 |
| `MONTH_NOT_DUE` | Month picker restricted to `dueMonths` from `commitments.get`; the error is a backstop | FR-024, OQ-1 |
| `MONTH_OUT_OF_HORIZON` | Navigation stops at the boundary and says so, rather than showing an empty month | FR-025 edge case |
| `OFFLINE_READ_ONLY` | Save is refused with "requires a connection"; the form keeps its input, nothing is queued | FR-035d |

Three of these — `DIRECTION_IMMUTABLE`, `MONTH_NOT_ACTIVE`, `MONTH_NOT_DUE` —
are backstops for states the UI prevents. They exist because the OpenAPI client
has no such UI, and because a constraint enforced only in a form is not enforced.

---

## What is deliberately not an error

- **Zero income.** `percentOfIncome` is `null`, per FR-033. Suppression, not
  failure.
- **An empty month.** `dashboard.month` returns empty arrays and zero totals for
  a month with no active commitment; `transfers.month` returns empty
  `destinations`. Both are rendered as explanatory empty states, per Story 6
  scenario 5.
- **`sharePercent = 0`.** A transfer line with `amount` zero, per the spec's edge
  case.
- **An amount of zero.** Accepted, so a paused contract needs no deletion.
- **A smoothed total differing from a cash total** over a range whose periods are
  not fully covered by active months. Stated by FR-028b as a property of the
  model; asserting equality there would be a wrong test.
- **A negative `remaining`.** A signed figure, not a failure.

---

## Audit and logging

`auth.register`, `auth.signIn`, `auth.signOut`, `dataRights.export` and
`dataRights.deleteAccount` append to the append-only audit log on **failure as
well as success**, per Article VIII's requirement to record authentication
events. Every other error is logged with its `appCode`, procedure name and
workspace identifier only — no input payload, because inputs to this feature
carry monetary amounts and account names, which Article VIII forbids in logs.
