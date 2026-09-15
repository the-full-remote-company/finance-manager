# Implementation Plan: Recurring Budget Planner

**Branch**: `001-recurring-budget-planner` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-recurring-budget-planner/spec.md`

**Artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) ·
[contracts/](./contracts/) · [quickstart.md](./quickstart.md)

## Summary

Replace the user's planning spreadsheet with a multi-tenant, forward-looking
budget planner. The user records standing commitments — name, category, source
account, amount, payment rhythm, contract end date, optional transfer
destination and share — and the system projects them onto a rolling 24-month
calendar, summing income and expenses per category per month and listing the
money that must move between accounts in a chosen month. It plans; it does not
record actual spending.

Technical approach: all projection arithmetic is pure integer arithmetic in
`packages/core` over a `YearMonth` index (`year * 12 + month - 1`), built
test-first. Money is `bigint` minor units end to end, with allocation proving
the parts sum to the whole and rounding confined to two named functions
(`allocate`, `applyShare`). Tenancy is enforced twice: RLS policies reading
`current_setting('app.workspace_id')` on every tenant-scoped table, plus tRPC
middleware scoping. Projection runs server-side per request over one query, with
nothing materialised. Offline is a read-only service-worker cache with no write
queue. This feature is the first to introduce a database, a test suite and a UI
package, so it also owes the CI gates the constitution left vacuous.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 LTS

**Primary Dependencies**: Next.js 16 (App Router, React 19), Tailwind CSS v4,
`@tfrc/product` 1.1.0 (`themes/finance`), tRPC 11, `trpc-to-openapi` 3.3,
Drizzle ORM 0.45 with drizzle-kit 0.31, Zod 4, `next-intl` 4, `@node-rs/argon2`
2.2, Serwist 9.5. Every `@tfrc/*` dependency pinned exactly, per Article V.

**Storage**: PostgreSQL 17, containerised locally and in CI. `bigint` minor units
plus `char(3)` currency for every amount; no `numeric`, no floating-point column.

**Testing**: Vitest (unit, integration), Playwright with `@axe-core/playwright`
(end-to-end, accessibility), disposable container PostgreSQL for anything
touching the database. See [ADR 0004](../../decisions/0004-test-stack.md).

**Target Platform**: Installable PWA served by a self-hosted Next.js process,
`de-DE` default locale. A native iOS client is planned and consumes the generated
OpenAPI document, not tRPC.

**Project Type**: Turborepo/pnpm monorepo — web application plus a
transport-agnostic domain package.

**Toolchain corrections made at scaffolding time** (recorded because the plan
stated versions that the registry contradicted): pnpm **12.4.2**, not 10 —
corepack ships it and its settings live in `pnpm-workspace.yaml`, not
`package.json`. ESLint **10**, Stylelint **17**, dependency-cruiser **18**.
TypeScript pinned to **5.9.3** although 7.0.2 is released, because
`typescript-eslint@8` declares `typescript <6.1.0`. Vitest **5.0.0**, not 5.0.1:
pnpm's `minimumReleaseAge` supply-chain policy rejects a package published
within the last day, and 5.0.1 was published the same day. Every
feature-bearing dependency in the list above resolved at the stated version.

**`tfrc-verify` does not exist.** Article V requires `npx tfrc-verify` in CI.
The registry carries exactly three `@tfrc` packages — foundation, marketing,
product at 1.1.0 — and none ships a `bin`; `tfrc-verify` and `@tfrc/verify`
both 404. `scripts/verify-design-system.mjs` performs the checks the
constitution attributes to the tool (exact pins, no marketing dialect, nothing
vendored, consumed classes present in the installed package) and CI runs the
real tool the moment it is published. Recorded in `PROMOTE.md`. This is a
stop-gap, not a waiver; if it outlives the first release it needs an ADR.

**Performance Goals**: SC-006 — dashboard readable within 2 s on a mid-range
phone over a typical mobile connection, month switch within 1 s. SC-011 — an
offline previously-viewed month renders within 2 s. Projection itself is
~3 100 commitment-months of integer arithmetic per request, well inside the
budget; the budget is dominated by network and paint, so neighbouring months are
prefetched.

**Constraints**: EU-only data storage and processing (Article VIII). Full test
suite runnable locally with no cloud account (Article VII). No offline write
queue by construction (FR-035d, ADR 0006). No hand-maintained OpenAPI document
(Article VI). WCAG 2.2 AA verified in CI, not asserted (Article IV).

**Scale/Scope**: One household workspace, roughly 130 commitments, 13
categories, 4 accounts, 24-month rolling horizon. 11 tables, 9 of them
tenant-scoped. 31 procedures across 10 routers. 44 functional requirements, 9
user stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution v1.0.0. An explicit verdict per article, as
"Development Workflow" requires.

| Article | Verdict | How this plan satisfies it |
|---|---|---|
| I. Tenant isolation at the database | **PASS** | All 9 tenant-scoped tables carry `workspace_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, and a policy with both `USING` and `WITH CHECK` on `current_setting('app.workspace_id')`. Application connects as non-owner role `app`. Intra-tenant references are composite foreign keys carrying `workspace_id`, so a cross-workspace reference is unrepresentable. tRPC middleware scopes in addition. A per-table leak test asserts zero rows read, updated or deleted across the boundary against real PostgreSQL. `NOT_FOUND` is byte-identical to non-existence, per contracts/errors.md. |
| II. Money is integer minor units | **PASS** | `bigint` minor units plus explicit `char(3)` currency in every column, DTO and intermediate value; money crosses the wire as a decimal string, never a JSON number. `fx_rates` with effective dates exists from the first migration. `allocate` is integer-exact with an earliest-month-first tie-break and a property test over ≥1 000 generated cases asserting the parts sum to the whole. Rounding occurs only in `applyShare`, half-up in `bigint`. Percentages leave the domain as exact rationals; `Intl.NumberFormat` performs the only display rounding. |
| III. Test-first where failure costs money or leaks data | **PASS** | Strict red-green-refactor for all of `packages/core`, for every auth/session/isolation change, and for every migration touching a tenant-scoped table. Vitest thresholds set at 90% lines and branches in `core` and 70% repo-wide. At least one Playwright end-to-end test per user story against a real database. |
| IV. WCAG 2.2 AA, verified | **PASS** | axe runs inside every Playwright run; serious or critical fails the build (SC-007). Touch targets inherit `--touch-min`. Every amount pairs colour with a sign or label per FR-043, including the signed `remaining` figure. Keyboard traversal and a screen-reader pass are recorded in the PR for each new interactive pattern (month navigator, commitment form, override editor). Status uses neither `--color-gain` nor `--color-loss`. |
| V. Design system consumed, never forked | **PASS** | `@tfrc/product@1.1.0` consumed via `themes/finance`; no CSS copied or vendored; `@tfrc/marketing` not installed. Exact version pins, `npx tfrc-verify` in CI, plus a contract test asserting the 17 consumed class names still exist. Raw colour literals and Tailwind arbitrary colours are lint errors. Table, date picker, select and modal are built locally in `packages/ui` on published tokens and logged in `PROMOTE.md` at use count 1 — nothing promoted before its third identical use. This feature creates `PROMOTE.md`, which does not yet exist. |
| VI. Domain logic transport-agnostic | **PASS** | `packages/core` imports nothing from this repo and nothing touching React, Next.js, tRPC, the ORM, HTTP or a DB client; boundary enforced mechanically by dependency-cruiser, not convention. All projection, smoothing, allocation, share and aggregation rules live there as pure functions over plain data. tRPC resolvers validate, authorise and translate only. The OpenAPI document is generated from the annotated procedures, published as a build artifact, and diff-checked in CI; a lint rule requires `.meta({ openapi })` on every public procedure and a contract test asserts full router coverage. |
| VIII. Personal data minimised, exportable, erasable | **PASS** | Data stays in the EU; the container database is local and no third-party processor receives anything, so none is owed a record. No speculative columns — every column has a named consumer in contracts/procedures.md. `dataRights.export` returns every field of every record (SC-008); `dataRights.deleteAccount` requires re-authentication and cascades genuinely, with no soft-delete flag anywhere in the schema, and the client purges every cache (FR-035e). `audit_events` is append-only and records authentication, export and deletion, with `workspace_id` and `user_id` nulled on the retained `account_deleted` record. No amount, account identifier or personal data appears in logs or error payloads. Secrets live only in environment configuration. IBAN columns are not introduced, since nothing consumes them yet. |

**Additional gates owed, because this is the first feature with a database, a
test suite and a UI package** (the constitution's sync-impact note declares them
vacuous but not waived): cross-tenant leak tests, coverage floors,
`npx tfrc-verify`, the class-name contract test, the raw-colour lint rule,
mechanical package-boundary enforcement, the accessibility scan in e2e, the
self-hosted build proof, and the hard-coded-string lint rule. All nine are
listed in [research.md](./research.md) Part C and become setup tasks, not
assumptions.

**Deviations requiring justification**: none. The Complexity Tracking table
below is therefore empty.

**ADRs written for this feature**: [0001 Drizzle as ORM](../../decisions/0001-drizzle-as-orm.md),
[0002 containerised PostgreSQL](../../decisions/0002-postgres-local-container.md),
[0003 hand-rolled sessions](../../decisions/0003-hand-rolled-sessions.md),
[0004 test stack](../../decisions/0004-test-stack.md),
[0005 OpenAPI generation](../../decisions/0005-openapi-generation.md),
[0006 offline read-only cache](../../decisions/0006-offline-read-only-cache.md).
Each covers a decision the constitution reserves for an ADR; none amends it.

## Project Structure

### Documentation (this feature)

```text
specs/001-recurring-budget-planner/
├── plan.md              # This file
├── spec.md              # Feature specification (with clarifications)
├── research.md          # Phase 0 output — stack decisions and domain algorithms
├── data-model.md        # Phase 1 output — 11 tables, RLS, constraints
├── quickstart.md        # Phase 1 output — setup and verification commands
├── contracts/
│   ├── README.md        # Wire conventions, router shape, requirement coverage
│   ├── procedures.md    # 31 procedures: input, output, errors
│   └── errors.md        # Error contract and required client handling
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/web/                      # Next.js App Router, de-DE default, PWA
├── app/
│   ├── (auth)/                # register, sign-in
│   ├── (app)/dashboard/       # month view: income, category totals, reserves, remaining
│   ├── (app)/transfers/       # per-month transfer instructions
│   ├── (app)/commitments/     # list, create, edit, amount history, overrides
│   ├── (app)/settings/        # accounts, categories, export, account deletion
│   └── api/trpc/              # tRPC handler + generated REST/OpenAPI handler
├── messages/de.json           # next-intl; no user-facing literal in code
├── sw.ts                      # Serwist: read-only SWR cache, no write path
└── tests/e2e/                 # Playwright + axe, one spec per user story

packages/core/                 # pure domain; imports nothing in this repo
├── src/money/                 # Money, allocate, applyShare
├── src/time/                  # YearMonth index, activity window
├── src/projection/            # rhythm, due months, period window, smoothing
├── src/dashboard/             # month aggregation, exact-rational percentages
├── src/transfers/             # share application, destination totals
└── tests/                     # unit + property tests; 90% lines and branches

packages/db/                   # Drizzle schema, hand-authored SQL migrations
├── src/schema/                # 11 tables
├── migrations/                # includes RLS policies and the non-owner role
└── tests/isolation/           # per-table cross-tenant leak tests

packages/api/                  # tRPC routers, Zod boundary schemas, OpenAPI meta
├── src/routers/               # auth, accounts, categories, commitments, amounts,
│                              # overrides, dashboard, transfers, dataRights, health
├── src/middleware/            # session, workspace scoping (SET LOCAL), rate limit
└── openapi/openapi.json       # generated artifact, diff-checked in CI

packages/auth/                 # argon2id hashing, session issue/verify/revoke, audit
packages/ui/                   # local components on @tfrc/product tokens
                               # table, date picker, select, modal → PROMOTE.md

PROMOTE.md                     # created by this feature (Article V)
docker-compose.yml             # PostgreSQL 17 service
```

**Structure Decision**: Turborepo/pnpm monorepo matching the constitution's
"Package boundaries" table exactly — `core`, `db`, `api`, `ui`, `apps/web` —
with `auth` added as its own package because [ADR 0003](../../decisions/0003-hand-rolled-sessions.md)
makes sessions and password hashing our own code, and the boundaries table
already names `auth` as a dependency of `api`. Hashing and session verification
are constitutionally test-first and must not sit inside `api` alongside
transport concerns. The boundaries are enforced by dependency-cruiser in `lint`,
so `packages/core` cannot acquire a React or ORM import without failing CI.

## Open questions and owed verifications

Carried from Phase 0/1. Each has a working default chosen on constitutional
grounds, so none blocks task generation; each becomes an explicit task.

| Item | Question | Default taken | Resolution path |
|---|---|---|---|
| OQ-1 | What does an override on a non-*due* month of a non-monthly commitment mean? | Reject with `MONTH_NOT_DUE`; the override form restricts the picker to `dueMonths` from `commitments.get`. Treating it as an override of a smoothed share would break FR-028's exact-sum guarantee. | User confirmation; if reversed, FR-028 needs amending first. |
| OQ-2 | Does the transfer view follow the selected presentation? | No. Transfers are always cash-view, because a transfer moves money actually leaving an account this month, and the spec's own 20,01 € example is a cash figure. | User confirmation; reversal is a spec change, not a code change. |
| VQ-1 | Does PostgreSQL 17 accept `EXTRACT` in a `GENERATED ALWAYS AS ... STORED` expression? | **RESOLVED 2026-09-15: yes.** Executed against PostgreSQL 17-alpine — expression accepted, indices correct across a year boundary, `NULL` propagates, column indexable. The fallback is not taken. | Done: `pnpm db:verify:generated-columns`, re-run in CI. |
| VQ-2 | Are tRPC queries actually issued as HTTP `GET` for this feature's largest input? | Assume the `httpBatchLink` default holds, but pin the method explicitly rather than inherit it. A silent degradation to `POST` makes queries uncacheable and breaks FR-035b. | Spike task plus an e2e assertion on the method. |

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.
