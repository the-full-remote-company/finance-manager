# Phase 0 Research: Recurring Budget Planner

**Feature**: `001-recurring-budget-planner` | **Date**: 2026-09-15

**Input**: [spec.md](./spec.md), [constitution v1.0.0](../../.specify/memory/constitution.md)

This document resolves every unknown in the plan's Technical Context. The
constitution already fixes most of the stack; what remains are the choices it
explicitly reserves for an ADR, plus the domain algorithms this feature needs
and which the spec describes in prose only.

Verified package availability at time of writing (`npm view <pkg> version`):
`drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `@trpc/server@11.18.0`,
`trpc-to-openapi@3.3.0`, `@node-rs/argon2@2.2.1`, `next@16.3.5`,
`next-intl@4.14.5`, `zod@4.6.5`, `vitest@5.0.1`, `@playwright/test@1.63.0`,
`@axe-core/playwright@4.13.0`, `serwist@9.5.12`, `@tfrc/product@1.1.0`.

---

## Part A — Stack decisions reserved for an ADR

### A1. ORM for `packages/db`

**Decision**: Drizzle ORM (`drizzle-orm`) with `drizzle-kit` for migrations.
Recorded as [ADR 0001](../../decisions/0001-drizzle-as-orm.md).

**Rationale**: Article I requires `ENABLE ROW LEVEL SECURITY`,
`FORCE ROW LEVEL SECURITY`, policies reading `current_setting('app.workspace_id')`,
and a non-owner application role. Drizzle's migrations are plain, hand-editable
SQL files, so the policies live in reviewable SQL rather than behind a generator.
Drizzle also exposes the underlying transaction directly, which is what
`SET LOCAL app.workspace_id` needs in order to be scoped to a single
transaction rather than leaking across a pooled connection.

**Alternatives considered**:

- *Prisma*: RLS requires `$queryRaw` escape hatches for the session variable, and
  its migration SQL is generated rather than authored, which makes policy review
  and hand-written `FORCE ROW LEVEL SECURITY` statements awkward to maintain.
- *Kysely + hand-rolled migrations*: equivalent control, but no schema-derived
  types from a single source, so `packages/core` DTO alignment becomes manual.

### A2. PostgreSQL hosting

**Decision**: containerised PostgreSQL 17 for development and CI. The managed
host decision is deferred to its own ADR when a real deployment is required.
Recorded as [ADR 0002](../../decisions/0002-postgres-local-container.md).

**Rationale**: Article VII already requires the full test suite to run locally
with no cloud account against containerised PostgreSQL, and requires CI to prove
a self-hosted configuration builds and runs. Satisfying those makes a managed
provider a later, reversible cost decision rather than an architectural one.
Nothing in this feature needs a hosted database to be built or verified.

**Alternatives considered**:

- *Neon (EU)*: free tier is generous and the region is compliant with Article
  VIII, but its serverless driver differs from plain `pg` over TCP, which would
  put a provider-specific client in the data path before it is needed.
- *Supabase (EU)*: plain PostgreSQL with good RLS tooling, but it bundles an auth
  and storage surface this project is required to self-host anyway, so most of
  the vendor is dead weight carrying Article VII friction.

### A3. Authentication foundation

**Decision**: hand-rolled session authentication in our own schema. Opaque
128-bit random session token, SHA-256 hashed at rest, delivered in a
`__Host-session` cookie; passwords hashed with argon2id via `@node-rs/argon2`.
Recorded as [ADR 0003](../../decisions/0003-hand-rolled-sessions.md).

**Rationale**: The constitution already dictates self-hosted auth in our own
database with argon2id, and Article VIII requires genuine erasure cascading to
every store plus an append-only audit log of authentication events. Owning the
`users` and `sessions` tables means both are plain foreign keys under our own
RLS policies rather than a library's schema sitting outside the tenancy model.
The surface needed for this release is small: register, sign in, sign out,
verify, throttle.

Argon2id parameters: `memoryCost = 19456` KiB (19 MiB), `timeCost = 2`,
`parallelism = 1` — the OWASP Password Storage Cheat Sheet's second listed
configuration. Recorded in the ADR so a future change is a visible decision.

**Alternatives considered**:

- *better-auth*: would hand us passkeys and MFA later, both of which the
  constitution explicitly defers. It owns its own tables and migration
  lifecycle, which conflicts with Article I's requirement that every
  tenant-scoped table carry our `workspace_id` and our leak test.
- *Lucia*: no longer a library, only a reference guide; adopting it means
  hand-rolling anyway, minus nothing.

### A4. Test and verification tooling

**Decision**: Vitest for unit and integration tests, Playwright with
`@axe-core/playwright` for end-to-end and accessibility, Testcontainers-style
disposable PostgreSQL via a `docker compose` service for anything touching the
database. Recorded as [ADR 0004](../../decisions/0004-test-stack.md).

**Rationale**: Article III requires strict TDD in `packages/core`, coverage
floors (90% `core`, 70% repo), real-PostgreSQL isolation tests, and at least one
end-to-end test per feature. Article IV requires an automated accessibility scan
inside every end-to-end run, failing the build at serious or critical severity.
Vitest gives V8 coverage with per-package thresholds; Playwright is the only
mainstream runner with a maintained first-party axe integration.

**Alternatives considered**: Jest (slower, ESM friction with a Turborepo/Tailwind
v4 toolchain), Cypress (weaker multi-origin and no first-party axe package).

### A5. OpenAPI document generation

**Decision**: `trpc-to-openapi`, generating the document from the same annotated
procedures at build time, published as a build artifact and diff-checked in CI.
Recorded as [ADR 0005](../../decisions/0005-openapi-generation.md).

**Rationale**: Article VI requires an OpenAPI document generated from the tRPC
procedures and explicitly forbids hand-maintaining it. A CI check that
regenerates and diffs the document makes staleness a build failure.

**Risk**: `trpc-to-openapi` requires `.meta({ openapi: ... })` on every exposed
procedure and only supports single (non-batched) calls on its REST handler.
Mitigation: a lint rule asserting every public procedure carries the meta, and a
contract test asserting the generated document covers every procedure in the
router. Both are tasks, not assumptions.

### A6. Offline strategy (read-only cache)

**Decision**: Serwist service worker. tRPC query traffic (HTTP GET) is cached
with a stale-while-revalidate strategy, stamped with an `x-cached-at` header at
write time so the UI can state when data was retrieved. Mutation traffic (HTTP
POST) is never cached and, when offline, fails fast with a typed
`OFFLINE_READ_ONLY` error. All caches plus the tRPC persisted client store are
destroyed on sign-out and on account deletion. Recorded as
[ADR 0006](../../decisions/0006-offline-read-only-cache.md).

**Rationale**: FR-035a–FR-035e require an installable app that launches offline,
keeps previously viewed months readable and visibly stale, distinguishes "no
data" from "not available offline", refuses writes without queueing them, and
discards everything on sign-out. A read-through cache with no write path is the
smallest construct that satisfies all five, and it cannot drift into a sync
engine by accident because there is no outbox to grow.

**Verification required before implementation** (spike task, not an assumption):
confirm that the tRPC client is configured such that queries are issued as HTTP
GET — this is the default for `httpBatchLink`, but it silently degrades for
inputs that exceed the URL length budget, which would make those queries
uncacheable. The spike must measure the largest real query input in this feature
(a month key plus a presentation flag — small) and pin the configuration
explicitly rather than relying on the default.

**VQ-2 result** (T017, `apps/web/lib/trpc/client.ts`): the largest real query
input, `dashboard.month`'s `{ month, presentation }`, serialises to well under
100 bytes — nowhere near `httpBatchLink`'s default 2 083-byte budget. Rather
than trust that margin to hold as the app grows, the client uses the
non-batching `httpLink`, which has no URL-length fallback at all: every query
is GET, unconditionally, with no threshold to silently cross. A test at
`apps/web/tests/unit/trpc-client.test.ts` asserts the actual `Request.method`
reaching `fetch` for both a query and a mutation.

---

## Part B — Domain algorithms

All of the following live in `packages/core` as pure functions over plain data,
per Article VI, and are built test-first, per Article III.

### B1. Month arithmetic

**Decision**: a `YearMonth` value object represented as a single integer
`index = year * 12 + (month - 1)`. All projection comparisons are integer
comparisons on this index. Calendar dates (start, contract end, notice deadline,
amount effective-from) are stored with day precision and reduced to a month
index for every projection decision.

**Rationale**: FR-026, FR-026a and FR-026b require whole-month granularity,
inclusive at both ends, with no proration by day count. Reducing dates to a
monotonic integer makes "contains or follows", "contains or precedes" and
rhythm-period arithmetic trivially correct and removes every timezone and
month-length question from the domain. Day precision is retained in storage
because FR-012's notice deadline is only meaningful as a date.

**Alternatives considered**: Temporal `PlainYearMonth` — correct but adds a
polyfill and gives nothing over an integer for this arithmetic; `date-fns` month
helpers — a dependency in `packages/core` for something that is one addition.

### B2. Activity window

**Decision**: a commitment is active in month `m` when
`m >= monthOf(startDate)` and, where a contract end date exists,
`m <= monthOf(endDate)`. Full amount, never prorated. A commitment starting and
ending inside one month is active for that one month.

**Rationale**: FR-026, FR-026a, and the resolved clarification of 2026-09-01.
Directly covers the acceptance scenario of a commitment starting 15 March
appearing in March at its full amount.

### B3. Rhythm, anchor, and due months

**Decision**: period lengths in months — monthly 1, quarterly 3, half-yearly 6,
yearly 12. One-off is modelled as a distinct rhythm, not as a period, and is due
in exactly its anchor month if that month is active.

Due months for a periodic rhythm are `anchor + k * period` for integer `k`,
restricted to months where the commitment is active. Because `k` may be
negative, an anchor before the start date is legal and simply yields no due
month until the first occurrence on or after the start month.

**Rationale**: FR-013, FR-014, FR-029 and the edge case "a commitment's start
date falls after its anchor month → the first due month is the first occurrence
on or after the start month". Allowing negative `k` is what makes an anchor a
phase marker rather than a second start date, which is what lets the user
anchor a yearly insurance to its historic billing month.

**Alternatives considered**: forbidding an anchor earlier than the start date —
rejected, because it forces the user to re-derive the phase by hand whenever a
contract's start is recorded later than its billing anchor.

### B4. Period window and smoothing

**Decision**: the period containing month `m` is
`periodStart = anchor + floor((m - anchor) / period) * period`, spanning
`period` consecutive months, with the charge due in `periodStart`. The charge is
allocated across all `period` months of that window and only then clipped to the
commitment's active months.

**Rationale**: FR-027, FR-028, FR-028a and the clarification of 2026-09-01
("smooth across the full period, then display only the active months"). The
worked example in the spec — a quarterly 240,00 € anchored to January ending in
February — yields January 80,00 €, February 80,00 €, March omitted, cash view
240,00 € in January. The floor division must be a true floor, not truncation
toward zero, so that months before the anchor land in the correct earlier
period; this is an explicit test case.

**Consequence, already stated by FR-028b**: smoothed and cash totals are equal
only over ranges where every period is fully covered by active months. The
implementation must not assert otherwise, and SC-002 is written to match.

### B5. Exact allocation

**Decision**: `allocate(totalMinor: bigint, parts: number): bigint[]` computes
`base = total / parts` and `remainder = total % parts` in integer arithmetic,
then distributes one extra minor unit to each of the first `remainder` months of
the period. Earliest-month-first is the documented tie-break.

`allocate(10_000n, 3) === [3_334n, 3_333n, 3_333n]` — sums to exactly 10 000.

**Rationale**: Article II forbids allocation that loses or invents minor units
and requires allocation functions to prove the parts sum to the whole. FR-028
and SC-002 require exactness across a full period, verified over at least one
thousand generated combinations — a property test asserting
`sum(allocate(t, n)) === t` and `max - min <= 1` for random `t`, `n`.

**Alternatives considered**: largest-remainder distribution — identical output
for equal-weight parts, more code; carrying a running fractional remainder —
rejected outright by Article II.

### B6. Amount in force, and overrides

**Decision**: the charge for a due month is the amount whose effective month is
the greatest effective month less than or equal to that due month. At most one
amount may exist per commitment per calendar month, enforced by a unique index
on a generated month column, which rejects both a duplicate effective date and
two different days inside the same month.

A month override replaces the charge for the month it names.

**Rationale**: FR-021 through FR-024, FR-026b, and the edge cases "two amounts
have effective dates on different days of the same month → rejected" and "the
same month is overridden twice → the later write replaces the earlier one".
Selecting on the due month rather than the displayed month is what keeps a
smoothed view internally consistent: one charge, one amount, then divided.

**Open interpretation — requires user confirmation, default chosen to keep the
plan moving**: the spec does not say what an override on a *non-due* month of a
non-monthly commitment means, since there is no charge in that month to replace.
Default taken here: reject it, with an error explaining that overrides attach to
the month the charge falls due, and surface the commitment's due months in the
override UI. The alternative — treating it as an override of that month's
smoothed share — would break FR-028's exact-sum guarantee for the period, so it
is rejected on constitutional grounds rather than preference. Flagged in plan.md
as item OQ-1.

### B7. Share rounding for transfers

**Decision**: `applyShare(amountMinor, sharePercent)` returns
`floor((amount * pct * 2 + 100) / 200)` in `bigint` arithmetic — half-up
rounding on a non-negative amount, with no intermediate float. A destination
total is the plain sum of those already-rounded lines.

`applyShare(4_001n, 50) === 2_001n`, matching the spec's worked example of
40,01 € at 50% reading 20,01 €.

**Rationale**: FR-039, FR-039a and FR-039b, plus the accepted edge case that
several rounded-up lines may push a destination total above the exact
mathematical total. Article II requires rounding to be explicit at the point it
occurs and tested with stated expectations, which is why rounding lives in this
one named function and nowhere else.

**Open interpretation — requires user confirmation, default chosen**: the spec
does not state whether the transfer view follows the user's selected
presentation. Default taken here: transfers are always computed from the cash
view, because a transfer is an instruction to move money that is actually
leaving an account in that month, and the spec's own example (20,01 € from a
40,01 € charge) is a cash figure. A smoothed transfer list would instruct the
user to move money that is not yet due. Flagged in plan.md as item OQ-2.

### B8. Dashboard aggregation

**Decision**: one pure function takes the workspace's commitments, amounts and
overrides plus a target month and presentation, and returns the month's income
list and total, per-category expense totals, overall expense total, reserves
total, combined total, remaining amount, and each category's percentage of
income expressed as an exact rational pair (numerator and denominator) or
`null` when income is zero.

**Rationale**: FR-031 through FR-034 and FR-033's requirement to suppress rather
than error on zero income. Returning a rational pair instead of a rounded
percentage keeps the last rounding decision in the presentation layer where
`Intl.NumberFormat` performs it, per Article II, and keeps the domain free of a
display concern.

Categories with no active commitment in the month are omitted from the response
entirely — the consistent choice permitted by acceptance scenario 5 of Story 3 —
and the absence is uniform across months so the layout does not flicker between
omission and zero.

### B9. Projection scale and where it runs

**Decision**: projection runs server-side in `packages/core`, invoked from a
tRPC procedure, over the workspace's full commitment set loaded in one query per
request. No projection rows are persisted or cached in the database.

**Rationale**: the spec's own volume is roughly 130 commitments, 13 categories,
4 accounts and a 24-month horizon — about 3 100 commitment-months in the worst
case, which is microseconds of integer arithmetic. Materialising a projection
table would add an invalidation problem for zero measured benefit, and SC-006's
budget (2 s first render, 1 s month switch) is dominated by network and paint,
not computation. Neighbouring months are prefetched to make the switch local.

**Alternatives considered**: computing in the browser from a synced commitment
set — rejected, because it would put domain arithmetic behind a cache that
Article VI's transport boundary exists to avoid and would weaken the offline
staleness signalling required by FR-035b.

---

## Part C — Constitutional infrastructure this feature must create

The constitution's sync-impact note states that the CI gates implied by Articles
I, III and V are "vacuous, not waived" until the first feature introduces a
database, a test suite, or a UI package. This feature introduces all three, so
it owes all three gates.

| Gate | Owed because | Shape |
|---|---|---|
| Cross-tenant leak tests | Article I; first tenant-scoped tables | Per table: a session bound to workspace A reads, updates and deletes zero rows of workspace B, against real PostgreSQL |
| Coverage floors | Article III; first test suite | Vitest thresholds — 90% lines and branches in `packages/core`, 70% lines repo-wide |
| `npx tfrc-verify` | Article V; first UI package | CI job, plus exact-version pinning of `@tfrc/*` |
| Design-system class contract test | Article V | Asserts the 17 classes published by `@tfrc/product@1.1.0` that this app consumes still exist: `.btn` `.btn--primary` `.btn--secondary` `.btn--ghost` `.btn--block` `.field` `.list` `.row` `.amt` `.amt--gain` `.amt--loss` `.balance` `.pill` `.pill--gain` `.pill--loss` `.seg` `.tabs` |
| Raw colour-literal lint | Article V | Stylelint rule plus a Tailwind arbitrary-colour lint error |
| Package boundary enforcement | "Package boundaries" table | Dependency-cruiser or ESLint boundaries, mechanical not conventional |
| Accessibility scan in e2e | Article IV | axe in every Playwright run; serious or critical fails the build |
| Self-hosted build proof | Article VII | CI builds and boots the app against the container database |
| Hard-coded string lint | "Locale" | ESLint rule making user-facing literals an error |

`PROMOTE.md` must be created by this feature as well, since Article V requires
promotion candidates to be tracked there and the file does not yet exist.

**Design-system sufficiency check**: `@tfrc/product@1.1.0` ships button, field,
list, row, amount, balance, pill, segmented control and tabs. That covers the
dashboard list, the month navigator (segmented control or tabs), amounts with
`.amt--gain`/`.amt--loss`, and the commitment form. It does **not** ship a table,
a date picker, a select, or a modal. Those are built locally in `packages/ui` on
the published tokens, per Article V, and logged in `PROMOTE.md` with a use count
of 1 — nothing may be promoted upstream before its third identical use.

**Article IV interaction with `--color-gain` / `--color-loss`**: those tokens are
reserved by the package for literal market direction. Income and expense
direction in this feature is literal money direction, so `.amt--gain` and
`.amt--loss` are the correct consumers. The reserve-versus-expense distinction
and the staleness indicator are *status*, not direction, and must therefore use
neither token. Every amount pairs its colour with a sign or label regardless, per
FR-043.

---

## Resolved unknowns summary

| Unknown | Resolution |
|---|---|
| ORM | Drizzle ORM + drizzle-kit, ADR 0001 |
| Database hosting | Containerised PostgreSQL 17, managed host deferred, ADR 0002 |
| Auth foundation | Hand-rolled argon2id sessions, ADR 0003 |
| Test tooling | Vitest + Playwright + axe + container PostgreSQL, ADR 0004 |
| OpenAPI generation | `trpc-to-openapi`, diff-checked in CI, ADR 0005 |
| Offline mechanism | Serwist read-only SWR cache, no write queue, ADR 0006 |
| Month granularity | Integer `YearMonth` index, dates stored day-precise |
| Smoothing rule | Allocate across full period, then clip to active months |
| Exactness | Integer `allocate` with earliest-first remainder |
| Share rounding | Half-up in `bigint`, per line, then summed |
| Percentage display | Domain returns exact rational, `Intl.NumberFormat` rounds |
| Projection location | Server-side, per request, not materialised |

Two interpretations remain open and are carried into plan.md as OQ-1 (overrides
on non-due months) and OQ-2 (transfers always use the cash view). Both have a
working default chosen on constitutional grounds, so neither blocks Phase 1.
