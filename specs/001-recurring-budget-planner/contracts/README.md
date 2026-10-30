# API Contracts: Recurring Budget Planner

**Feature**: `001-recurring-budget-planner` | **Date**: 2026-09-15

The interface `apps/web` and the planned native iOS client consume. tRPC is the
transport for the web client; the OpenAPI document generated from the same
procedures serves everything else, per Article VI and
[ADR 0005](../../../decisions/0005-openapi-generation.md).

- [procedures.md](./procedures.md) — every procedure, its input, its output, its errors
- [errors.md](./errors.md) — the error contract and what the UI must do with each code

## Wire conventions

These bind every procedure and exist so a Swift client can consume the OpenAPI
document without a TypeScript-specific decoder.

**Money is a decimal string of minor units.** `{ "minor": "95000", "currency": "EUR" }`
is 950,00 €. JSON numbers cannot represent `bigint` safely and `superjson`
would make the document TypeScript-only, which defeats the purpose Article VI
states for generating it. Validated as `z.string().regex(/^\d+$/)` and parsed to
`bigint` at the trust boundary, before anything crosses into `packages/core`.
Never a JSON number, never a float, per Article II.

**A month is `"YYYY-MM"`.** The integer index from
[data-model.md](../data-model.md) is internal to `packages/core`; the wire
format is readable and unambiguous. Validated as
`z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)`.

**A date is `"YYYY-MM-DD"`.** Day precision is preserved on the wire for start
date, contract end date, notice deadline and amount effective-from, because the
notice deadline is only meaningful as a date. Every projection comparison
reduces it to a month, per FR-026.

**A percentage of income is an exact rational or `null`.**
`{ "numerator": "24000", "denominator": "96000" }`, or `null` when the month's
income is zero. The server does not round it; `Intl.NumberFormat` in the client
does, per Article II and FR-033.

**Identifiers are UUID strings.** A response for a record in another workspace is
indistinguishable from one that does not exist, per FR-003.

**Method mapping.** Queries are HTTP `GET`, mutations are HTTP `POST`. This is
pinned in the client transport rather than inherited from the default, because
[ADR 0006](../../../decisions/0006-offline-read-only-cache.md) depends on
queries being cacheable by the service worker, and a query that silently
degrades to `POST` would break FR-035b.

**Every procedure except the four unauthenticated ones** runs inside one
transaction that has already executed `SET LOCAL app.workspace_id`, per
[ADR 0001](../../../decisions/0001-drizzle-as-orm.md). The unauthenticated four
are `auth.register`, `auth.signIn`, `auth.signOut` and `health`.

**Every input is validated by a Zod schema at the boundary.** Validated types,
never raw request objects, cross into `packages/core`, per "Baseline security
controls".

**Every mutation is rate limited**, per "Baseline security controls".

## Router shape

```text
auth        register, signIn, signOut, session
accounts    list, create, rename, reorder, delete, referenceCount
categories  list, create, rename, reorder, delete, referenceCount
commitments list, get, create, update, delete
amounts     add, update, remove
overrides   set, remove
dashboard   month, horizon
transfers   month
dataRights  export, deleteAccount
health      ping
```

## Requirement coverage

Every functional requirement in the spec is reachable through this surface.

| Area | Requirements | Procedures |
|---|---|---|
| Workspace and access | FR-001 – FR-006 | `auth.*` |
| Reference data | FR-007 – FR-009a | `accounts.*`, `categories.*` |
| Commitments | FR-010 – FR-020 | `commitments.*` |
| Amounts over time | FR-021 – FR-024 | `amounts.*`, `overrides.*` |
| Projection | FR-025 – FR-030 | `dashboard.*`, `transfers.month` |
| Dashboard | FR-031 – FR-035 | `dashboard.month` |
| Offline | FR-035a – FR-035e | client and service worker; `x-cached-at` on every query response |
| Transfers | FR-036 – FR-039b | `transfers.month` |
| Data rights | FR-040, FR-041 | `dataRights.*` |
| Presentation | FR-042 – FR-044 | client; the API returns unrounded data and locale-independent values |
