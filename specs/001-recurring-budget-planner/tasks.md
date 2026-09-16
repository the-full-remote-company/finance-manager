---

description: "Task list for 001-recurring-budget-planner"
---

# Tasks: Recurring Budget Planner

**Input**: Design documents from `/specs/001-recurring-budget-planner/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: MANDATORY, not optional. Article III requires strict red-green-refactor
for everything in `packages/core`, for every change touching tenant isolation,
authentication, authorisation or session handling, and for every migration that
adds or alters a tenant-scoped table. Every feature owes at least one end-to-end
test against a real database. Article IX forbids weakening any of it.

**Organization**: Grouped by user story (US1–US9, priorities P1–P9) so each is
independently implementable and testable. Story order follows the spec's
priorities; the dependency notes below state where a later story extends an
earlier story's code rather than replacing it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to
- **TDD pairs**: a task labelled *(test first)* MUST be observed to fail for the
  intended reason before its implementation task begins

## Path Conventions

Monorepo layout from [plan.md](./plan.md#project-structure): `packages/core`,
`packages/db`, `packages/api`, `packages/auth`, `packages/ui`, `apps/web`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository, toolchain, and the nine CI gates this feature owes
because it is the first with a database, a test suite and a UI package
([research.md](./research.md) Part C).

- [x] T001 Initialise the Turborepo/pnpm monorepo at the repository root: `package.json` with `packageManager: pnpm@10`, `pnpm-workspace.yaml`, `turbo.json`, a base `tsconfig.json` with `strict: true`, Node 22 in `.nvmrc`
- [x] T002 [P] Create empty publishable package skeletons with their own `package.json` and `tsconfig.json`: `packages/core`, `packages/db`, `packages/api`, `packages/auth`, `packages/ui`
- [x] T003 [P] Scaffold `apps/web` with Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4
- [x] T004 [P] Write `docker-compose.yml` with a single PostgreSQL 17 service, plus `packages/db/scripts/init-roles.sql` creating the migration owner and the non-owner, non-superuser `app` role that the application connects as (Article I)
- [x] T005 [P] Write `.env.example` with `DATABASE_URL_OWNER`, `DATABASE_URL`, `SESSION_COOKIE_NAME`; add `.env.local` to `.gitignore` (Article VIII: secrets only in environment configuration)
- [x] T006 [P] Configure ESLint 9 flat config and Prettier at the root, with `pnpm lint` and `pnpm typecheck` scripts wired through Turborepo
- [x] T007 [P] Add dependency-cruiser with rules encoding the constitution's package-boundary table, so `packages/core` importing React, Next.js, tRPC, the ORM, or any HTTP or DB client fails `pnpm lint` (Article VI, mechanically enforced)
- [x] T008 [P] Add Stylelint with a no-raw-colour rule (hex, `rgb()`, `oklch()`) and an ESLint rule rejecting Tailwind arbitrary colour values such as `bg-[#fff]` (Article V)
- [x] T009 [P] Add the `next-intl` ESLint rule making any user-facing string literal in `apps/web` or `packages/ui` an error, with `apps/web/messages/de.json` as the only string source (Article V "Locale", FR-042)
- [x] T010 [P] Configure Vitest workspace with V8 coverage and per-package thresholds: 90% lines and branches for `packages/core`, 70% lines repo-wide, both failing the run when unmet (Article III)
- [x] T011 [P] Configure Playwright with `@axe-core/playwright`, a shared `expectNoSeriousA11yViolations` helper that fails on serious or critical severity, and projects for desktop and a mid-range mobile viewport (Article IV, SC-007)
- [x] T012 Install `@tfrc/product@1.1.0` at an exact version, import `themes/finance` in `apps/web/app/layout.tsx`, add the `pnpm verify:design-system` script running `npx tfrc-verify`, and assert `@tfrc/marketing` is absent (Article V)
- [x] T013 [P] Create `PROMOTE.md` at the repository root with the promotion rule stated (third identical use, never earlier) and an empty candidates table (Article V; the file does not yet exist)
- [x] T014 [P] Add the root `pnpm verify` script chaining every gate in the order given in [quickstart.md](./quickstart.md#verifying-a-change), cheapest signal first
- [x] T015 Add `.github/workflows/ci.yml` running every gate on every pull request against the container database, including the self-hosted build-and-boot proof (Article VII), with no gate marked `continue-on-error`

### Owed verifications — spikes, not assumptions

- [x] T016 **VQ-1**: write `packages/db/scripts/verify-generated-columns.sql` and the `pnpm db:verify:generated-columns` script; execute against PostgreSQL 17 to confirm `EXTRACT(... FROM <date>)` is accepted inside `GENERATED ALWAYS AS ... STORED`. Record the result in [data-model.md](./data-model.md). If rejected, switch the month-index columns to plain `integer not null` plus a `CHECK` constraint derived in `packages/core` — the schema shape and constraints are unchanged either way. Blocks T033.
- [x] T017 **VQ-2**: pin the tRPC client transport so queries are issued as HTTP `GET`, measure the largest real query input in this feature (a month key plus a presentation flag), and add a test asserting the method. A silent degradation to `POST` makes queries uncacheable and breaks FR-035b. Blocks T098.

**Checkpoint**: `pnpm verify` runs on an empty repository and every gate is red for absence of code, not for absence of configuration.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain primitives, the tenancy mechanism, the transport, and the
error contract. Nothing in any user story can be built before these hold.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

### Domain primitives in `packages/core` — strict TDD

- [x] T018 [P] *(test first)* `packages/core/tests/money/money.test.ts`: `Money` is `{ minor: bigint, currency: string }`; construction rejects a non-ISO-4217 currency and a JavaScript `number` input; addition, subtraction and summation refuse to mix currencies. **`Money` is signed**: FR-020's rejection of negative amounts is enforced by a separate `assertChargeAmount` guard at the trust boundary, not by the type, because `dashboard.month.remaining` is `income - combined` and the contract states it may be negative — "the one signed figure in the payload". A non-negative `Money` type would make that payload unrepresentable
- [x] T019 [P] Implement `packages/core/src/money/money.ts` to satisfy T018, including `assertChargeAmount` for FR-020. No floating-point value appears in any signature or intermediate (Article II)
- [x] T020 [P] *(test first)* `packages/core/tests/money/allocate.test.ts`: `allocate(10_000n, 3) === [3_334n, 3_333n, 3_333n]`; earliest-part-first is the documented tie-break; plus a property test over ≥1 000 generated `(total, parts)` pairs asserting `sum(allocate(t, n)) === t` and `max - min <= 1` (Article II, SC-002)
- [x] T021 [P] Implement `packages/core/src/money/allocate.ts` with integer `base` and `remainder` only — no running fractional remainder, which Article II rejects outright
- [x] T022 [P] *(test first)* `packages/core/tests/money/apply-share.test.ts`: `applyShare(4_001n, 50) === 2_001n` (half-up, the spec's worked example); `applyShare(x, 0) === 0n`; `applyShare(x, 100) === x`; the same input always yields the same output (FR-039a); no intermediate float
- [x] T023 [P] Implement `packages/core/src/money/apply-share.ts` as `floor((amount * pct * 2 + 100) / 200)` in `bigint`. This is the only place in the repository where a share is rounded (FR-039)
- [x] T024 [P] *(test first)* `packages/core/tests/time/year-month.test.ts`: `YearMonth` index `year * 12 + (month - 1)`; round-trip with the `"YYYY-MM"` wire format; `monthOf(date)` reduces a day-precise date to its month; comparison and addition across a year boundary; rejection of month 0 and month 13
- [x] T025 [P] Implement `packages/core/src/time/year-month.ts` to satisfy T024
- [x] T026 [P] *(test first)* `packages/core/tests/money/percentage.test.ts`: a category total over income returns an exact rational `{ numerator, denominator }`, and returns `null` — not `0`, not a throw — when income is zero (FR-033)
- [x] T027 [P] Implement `packages/core/src/money/percentage.ts`. The domain never rounds a percentage; `Intl.NumberFormat` in the client performs the only display rounding (Article II)

### Schema and tenancy in `packages/db` — strict TDD, Article III

- [x] T028 Configure Drizzle: `packages/db/drizzle.config.ts`, a `pg` client that connects as the non-owner `app` role at runtime and as the owner for migrations only, and the `pnpm db:migrate` / `db:reset` scripts
- [x] T029 Write `packages/db/src/rls.ts` exposing `withWorkspace(workspaceId, fn)`, which opens one transaction, executes `SET LOCAL app.workspace_id = $1`, and runs the callback inside it. `SET LOCAL`, never `SET`, so the setting cannot leak across a pooled connection ([ADR 0001](../../decisions/0001-drizzle-as-orm.md))
- [x] T030 *(test first)* `packages/db/tests/isolation/harness.test.ts`: a reusable harness that seeds two workspaces with overlapping data and, for a named table, asserts that a session bound to workspace A reads, updates and deletes **zero** rows of workspace B, by direct identifier. Runs against real PostgreSQL, never a mock (Article I, SC-004)
- [x] T031 *(test first)* `packages/db/tests/isolation/policy-coverage.test.ts`: every table in the schema has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and a policy with both `USING` and `WITH CHECK`, except exactly `{auth_attempts, fx_rates}`. A future table cannot join the exempt set silently ([data-model.md](./data-model.md))
- [x] T032 Write migration `0001_roles_and_extensions.sql`: `pgcrypto`, the enum types `direction`, `commitment_kind`, `rhythm`, `audit_event_type`, and the grants for the `app` role
- [x] T033 Write migration `0002_workspaces_users_sessions.sql` with `workspaces`, `users`, `sessions` per [data-model.md](./data-model.md), including RLS on all three, `unique (workspace_id, id)` where referenced, and the month-index convention settled by T016
- [x] T034 [P] Write migration `0003_audit_and_throttling.sql`: `audit_events` with nullable non-foreign-key `workspace_id` and `user_id` and `REVOKE UPDATE, DELETE ... FROM app` for append-only enforcement by grant; `auth_attempts` with no `workspace_id` and no policy
- [x] T035 [P] Write migration `0004_fx_rates.sql`: the FX rate table with effective dates, required by Article II from the first migration that introduces money even while one currency is displayed
- [x] T036 Run the T030 harness against `workspaces`, `users`, `sessions` and `audit_events`; all four leak tests green. `audit_events` is tenant-scoped and carries a policy despite its nullable `workspace_id`, so its read path is covered like any other; its append-only grant is asserted separately in T057

### Transport and error contract in `packages/api`

- [x] T037 Initialise tRPC 11 in `packages/api`: root router, `publicProcedure`, and `superjson` explicitly **not** used on the OpenAPI-exposed path, since money crosses the wire as a decimal string ([contracts/README.md](./contracts/README.md))
- [x] T038 Write `packages/api/src/schemas/primitives.ts`: the Zod schemas for the wire conventions — `Money` as `{ minor: z.string().regex(/^\d+$/), currency }` parsed to `bigint` at the boundary, `Month` as `/^\d{4}-(0[1-9]|1[0-2])$/`, `Date` as `YYYY-MM-DD`, `Percentage` as an exact rational or `null`. Validated types, never raw request objects, cross into `packages/core`
- [x] T039 *(test first)* `packages/api/tests/errors.test.ts`: every code in [contracts/errors.md](./contracts/errors.md) maps to its stated transport code and `data.appCode`; `details` never carries a monetary amount, an account identifier or personal data; and a cross-workspace `NOT_FOUND` response is **byte-identical** to a genuinely-absent `NOT_FOUND`, including `message` and field order (FR-003, Article I)
- [x] T040 Implement `packages/api/src/errors.ts` to satisfy T039: machine token in `message`, `appCode` in `data`, no server-authored human sentence anywhere
- [x] T041 Implement `packages/api/src/middleware/workspace.ts`: `protectedProcedure` resolves the session, then runs the whole resolver inside `withWorkspace`. Application-layer scoping in addition to RLS, never instead (Article I)
- [x] T042 [P] Implement `packages/api/src/middleware/rate-limit.ts` backed by `auth_attempts`, applied to every mutation and to `auth.*`, returning `RATE_LIMITED` with `retryAfterSeconds` ("Baseline security controls", FR-005)
- [x] T043 [P] Implement `packages/api/src/routers/health.ts` — `health.ping` returning `{ ok: true, time }`, unauthenticated, and explicitly excluded from service-worker caching in T098
- [x] T044 [P] Add the ESLint rule requiring `.meta({ openapi: ... })` on every public procedure, so an unannotated procedure fails `pnpm lint` rather than silently vanishing from the document ([ADR 0005](../../decisions/0005-openapi-generation.md))
- [x] T045 Wire `trpc-to-openapi` generation into the build, emit `packages/api/openapi/openapi.json` as a committed artifact, and add `pnpm openapi:check` which regenerates and diffs it (Article VI: never hand-maintained)
- [x] T046 *(test first)* `packages/api/tests/openapi-coverage.test.ts`: the generated document covers every procedure in the router, and the REST handler is exercised without batching
- [x] T047 Mount the handlers in `apps/web/app/api/trpc/[trpc]/route.ts` and the REST/OpenAPI handler alongside it

### Web shell, locale, design system

- [x] T048 Configure `next-intl` with `de-DE` as the default and only locale, `apps/web/messages/de.json`, and the currency and date formatters built on `Intl.NumberFormat` and `Intl.DateTimeFormat` — never hand-rolled (Article II, FR-042)
- [x] T049 *(test first)* `packages/ui/tests/design-system-contract.test.ts`: assert the existence of the 17 `@tfrc/product` classes this app consumes — `.btn` `.btn--primary` `.btn--secondary` `.btn--ghost` `.btn--block` `.field` `.list` `.row` `.amt` `.amt--gain` `.amt--loss` `.balance` `.pill` `.pill--gain` `.pill--loss` `.seg` `.tabs` — so an upstream rename fails the build rather than a screen (Article V)
- [x] T050 [P] Build `packages/ui/src/Amount.tsx`: renders a `Money` via `Intl.NumberFormat`, pairs every sign with a label or symbol, and uses `.amt--gain`/`.amt--loss` only for literal money direction — never for status (Article IV, FR-043, research Part C)
- [x] T051 [P] Build the local components `@tfrc/product` does not ship — `Table`, `DatePicker`, `Select`, `Modal` — in `packages/ui/src/`, on published tokens only, and log each in `PROMOTE.md` at use count 1 (Article V)
- [x] T052 [P] Build `apps/web/app/layout.tsx` with the app shell: skip link, landmark regions, the `themes/finance` stylesheet, and an ARIA live region for the countdown and offline announcements

### Auth foundation in `packages/auth` — strict TDD, Article III

- [x] T053 [P] *(test first)* `packages/auth/tests/password.test.ts`: argon2id with `memoryCost = 19456`, `timeCost = 2`, `parallelism = 1` ([ADR 0003](../../decisions/0003-hand-rolled-sessions.md)); verification of a correct password succeeds, a wrong one fails, and the hash is never logged
- [x] T054 [P] Implement `packages/auth/src/password.ts` with `@node-rs/argon2` to satisfy T053
- [x] T055 [P] *(test first)* `packages/auth/tests/session.test.ts`: a 128-bit random opaque token, SHA-256 hashed at rest so the raw token never reaches the database; issue, verify, revoke; an expired or revoked token verifies as absent
- [x] T056 [P] Implement `packages/auth/src/session.ts` and the `__Host-session` cookie with `httpOnly`, `Secure`, `SameSite=Lax` ("Baseline security controls")
- [x] T057 [P] *(test first)* `packages/auth/tests/audit.test.ts`: each of `sign_in_succeeded`, `sign_in_failed`, `signed_out`, `export_performed`, `account_deleted` writes the stated `detail` shape, and no event carries an email address, an account name or a monetary amount (Article VIII)
- [x] T058 [P] Implement `packages/auth/src/audit.ts` as append-only writes to `audit_events`

**Checkpoint**: Foundation ready. The domain arithmetic is proven, tenancy is enforced and tested, the transport and error contract exist, and user story work can begin.

---

## Phase 3: User Story 1 — A private, isolated workspace (Priority: P1) 🎯 MVP

**Goal**: A person registers, receives their own workspace, and no record of any
other workspace is reachable by any route, including by direct identifier.

**Independent Test**: Create two workspaces with data in each; verify from each
session that no record of the other is readable, writable or deletable through
any route, including by direct identifier.

### Tests for User Story 1 (write first, observe failing)

- [x] T059 [P] [US1] `packages/api/tests/auth/register.test.ts`: registration creates exactly one workspace with the registrant as its only member (FR-001); a duplicate email is rejected without disclosing that the account exists
- [x] T060 [P] [US1] `packages/api/tests/auth/sign-in.test.ts`: correct credentials issue a session; wrong password and unknown user return an identical generic `AUTH_FAILED` with no timing branch that distinguishes them
- [x] T061 [P] [US1] `packages/api/tests/auth/throttle.test.ts`: repeated failed attempts cross the threshold and return `RATE_LIMITED` with `retryAfterSeconds` (FR-005, Story 1 scenario 4)
- [x] T062 [P] [US1] `packages/api/tests/auth/session-expiry.test.ts`: an expired or revoked session reaches zero workspace data on every protected procedure (FR-004, Story 1 scenario 3)
- [ ] T063 [P] [US1] `apps/web/tests/e2e/us1-isolation.spec.ts`: two registered users, each with a commitment; user A requests user B's identifier through every route and receives the absent-record response every time, plus the axe scan on the auth screens

### Implementation for User Story 1

- [x] T064 [US1] Implement `packages/api/src/routers/auth.ts`: `register`, `signIn`, `signOut`, `session` per [contracts/procedures.md](./contracts/procedures.md), with the workspace named from the registrant's display name
- [x] T065 [US1] Apply `protectedProcedure` to every procedure except the four unauthenticated ones (`auth.register`, `auth.signIn`, `auth.signOut`, `health.ping`) and assert the exempt set in a test, so a new procedure cannot join it silently (FR-004)
- [x] T066 [P] [US1] Build the register and sign-in screens in `apps/web/app/(auth)/`, with field-level errors on `details.path`, focus moved to the first invalid field, and the throttle countdown announced via the live region ([contracts/errors.md](./contracts/errors.md))
- [x] T067 [P] [US1] Add the strict Content-Security-Policy without `unsafe-inline` for scripts, HSTS, and HTTPS-only headers in `apps/web/next.config.ts` ("Baseline security controls")
- [x] T068 [US1] Wire audit writes for `sign_in_succeeded`, `sign_in_failed` and `signed_out`, on failure as well as success (FR-006)

**Checkpoint**: US1 is independently functional. Nothing else in this feature may be built before it holds — it is the precondition for storing any financial data.

---

## Phase 4: User Story 2 — Capture what I am committed to (Priority: P2)

**Goal**: The user records accounts, categories and commitments, and every field
persists intact.

**Independent Test**: Enter one income and one expense, reopen the list, and
confirm both persist with every field intact.

### Tests for User Story 2 (write first, observe failing)

- [x] T069 [P] [US2] `packages/db/tests/isolation/reference-data.test.ts`: the T030 harness applied to `accounts` and `categories` (Article I — a new tenant-scoped table without its leak test must not merge)
- [x] T070 [P] [US2] `packages/db/tests/isolation/commitments.test.ts`: the same harness applied to `commitments`, `commitment_amounts` and `amount_overrides`
- [x] T071 [P] [US2] `packages/db/tests/cross-workspace-fk.test.ts`: a commitment in workspace A cannot reference a category or account in workspace B, rejected by the composite foreign key, not by application code ([data-model.md](./data-model.md))
- [x] T072 [P] [US2] `packages/api/tests/reference-data.test.ts`: create, rename, reorder, delete for accounts and categories; `NAME_TAKEN` on a duplicate; rename permitted while referenced (FR-009a); `DIRECTION_IMMUTABLE` on an attempted category direction change
- [x] T073 [P] [US2] `packages/api/tests/reference-data-delete.test.ts`: deleting a referenced category or account returns `STILL_REFERENCED` with the count, and both reference kinds — source and transfer destination — count toward an account's total (FR-009, edge case). Deleting the last *unreferenced* category or account is permitted
- [x] T074 [P] [US2] `packages/api/tests/commitments-create.test.ts`: every rule in the `commitments.create` table — `ANCHOR_REQUIRED`, `TRANSFER_EQUALS_SOURCE`, `END_BEFORE_START`, `NEGATIVE_AMOUNT`, `DIRECTION_MISMATCH`, and `NOT_FOUND` for a category or account in another workspace. An amount of zero is accepted. `sharePercent` defaults to 100 and accepts 0 through 100 inclusive (FR-015)
- [x] T075 [P] [US2] `packages/api/tests/commitments-mutate.test.ts`: `update` cannot change an amount (that is `amounts.*`); `delete` cascades to amounts and overrides and removes the commitment from every month in the horizon, including past ones (Story 2 scenario 5)
- [ ] T076 [P] [US2] `apps/web/tests/e2e/us2-capture.spec.ts`: create an account "Girokonto" and a category "Wohnen", then a monthly expense "Miete" of 950,00 €; reopen the list and assert every field, German locale formatting with a euro symbol, a missing-required-field message, and the axe scan

### Implementation for User Story 2

- [x] T077 [US2] Write migration `0005_accounts_categories.sql` per [data-model.md](./data-model.md): name checks, the account's optional `note`, the user-defined `sort_order`, category `direction`, RLS, and `unique (workspace_id, id)`. No balance and no bank identifier column — an account is a label, and a column with no current consumer must not be added speculatively (FR-007, Article VIII)
- [x] T078 [US2] Write migration `0006_commitments.sql`: all columns plus the three `CHECK` constraints for FR-014, FR-016 and FR-017, the composite `RESTRICT` foreign keys, and the four indexes
- [x] T079 [US2] Write migration `0007_amounts_overrides.sql`: `commitment_amounts` with `unique (commitment_id, effective_month)`, `amount_overrides` with `unique (commitment_id, month)`, both cascading from their commitment
- [x] T080 [P] [US2] Implement `packages/db/src/schema/` for the five new tables and export the inferred types
- [x] T081 [P] [US2] Implement `packages/core/src/commitment/validate.ts`: the direction-agreement rule that the database cannot express across tables without a trigger, which Article VI forbids — validated in the domain and covered by T074
- [x] T082 [US2] Implement `packages/api/src/routers/accounts.ts` and `categories.ts`: `list`, `create`, `rename`, `reorder`, `delete`, `referenceCount`
- [x] T083 [US2] Implement `packages/api/src/routers/commitments.ts`: `list`, `get`, `create`, `update`, `delete`, with `create` enforcing "at least one amount" and "earliest effective month at or before the start month" in the same transaction (FR-011)
- [x] T084 [P] [US2] Build the settings screens for accounts and categories in `apps/web/app/(app)/settings/`, including the blocking `STILL_REFERENCED` dialog that states the count and offers rename instead of delete
- [x] T085 [P] [US2] Build the commitment list and the create/edit form in `apps/web/app/(app)/commitments/`, with the anchor field revealed only for a non-monthly rhythm, and the empty-state explanation that a category and an account must exist first (edge case)
- [ ] T086 [US2] Add the "add a commitment on a phone in under 60 seconds" Playwright measurement to `us2-capture.spec.ts` (SC-005)

**Checkpoint**: US1 and US2 both work independently. Data exists; nothing displays it yet.

---

## Phase 5: User Story 3 — See a month summarised by category (Priority: P3)

**Goal**: The dashboard shows one month: income with a total, each expense
category with its total and percentage of income, the overall total and the
remaining amount — readable on a phone, and readable offline once viewed.

**Independent Test**: With a known set of commitments, open a month and verify
each category total equals the sum of its commitments for that month and that
percentages match those totals divided by that month's income.

**Note**: This phase implements monthly commitments only. Non-monthly rhythms,
smoothing and the presentation toggle arrive with US4, which extends the same
aggregation function rather than replacing it.

### Tests for User Story 3 (write first, observe failing)

- [ ] T087 [P] [US3] `packages/core/tests/time/activity-window.test.ts`: active in month `m` when `m >= monthOf(startDate)` and, where an end date exists, `m <= monthOf(endDate)`; a commitment starting 15 March is active in March at its full amount, never prorated (FR-026, FR-026a)
- [ ] T088 [P] [US3] `packages/core/tests/dashboard/aggregate.test.ts`: income list and total, per-category expense totals, overall expense total, combined total, `remaining` (which may be negative), and `percentOfIncome` as an exact rational — `null` when income is zero (FR-031, FR-033, FR-034). A category with no active commitment in the month is omitted, uniformly across months
- [ ] T089 [P] [US3] `packages/api/tests/dashboard-month.test.ts`: `MONTH_OUT_OF_HORIZON` outside the rolling window; `retrievedAt` present on every response; presentation is a parameter, never server state (FR-030 is client-side)
- [ ] T090 [P] [US3] `apps/web/tests/e2e/us3-dashboard.spec.ts`: category totals and percentages against a known fixture; zero-income month suppresses percentages; month navigation preserves scroll position; no horizontal scrolling at the mobile viewport (FR-035); axe scan
- [ ] T091 [P] [US3] `apps/web/tests/e2e/us3-offline.spec.ts`: the app launches with the network disabled; a previously viewed month renders within 2 s marked with its retrieval time; a month never visited shows "not available offline", distinct from "no data"; a save attempt fails immediately with `OFFLINE_READ_ONLY` and nothing is queued; sign-out destroys every cache (FR-035a–FR-035e, SC-011)

### Implementation for User Story 3

- [ ] T092 [P] [US3] Implement `packages/core/src/time/activity-window.ts`
- [ ] T093 [US3] Implement `packages/core/src/dashboard/aggregate.ts` as one pure function over commitments, amounts, overrides, a target month and a presentation, returning the full payload shape from [contracts/procedures.md](./contracts/procedures.md)
- [ ] T094 [US3] Implement `packages/api/src/routers/dashboard.ts`: `horizon` returning the rolling 24-month window, and `month` loading the workspace's commitment set in **one** query per request and calling T093. No projection row is persisted or cached in the database (research B9)
- [ ] T095 [P] [US3] Build the dashboard screen in `apps/web/app/(app)/dashboard/`: income list with total, category rows with totals and percentages, overall and remaining figures, all through `packages/ui/Amount`
- [ ] T096 [P] [US3] Build the month navigator on `.seg` or `.tabs`, stopping at the horizon boundary with a clear indication rather than an empty screen (FR-025 edge case), and preserving the user's scroll position across navigation (Story 3 scenario 4)
- [ ] T097 [P] [US3] Prefetch the neighbouring months so a month switch is local, meeting the 1 s budget in SC-006
- [ ] T098 [US3] Implement `apps/web/sw.ts` with Serwist: stale-while-revalidate for query `GET` traffic, an `x-cached-at` header stamped at write time, no cache entry for any mutation, and `health.ping` explicitly excluded — a cached success would report a live server to an offline client ([ADR 0006](../../decisions/0006-offline-read-only-cache.md)). Depends on T017
- [ ] T099 [US3] Synthesise `OFFLINE_READ_ONLY` in the service worker for any mutation attempted offline, so a save fails immediately instead of hanging to a transport timeout, with the user's typed input left on screen (FR-035c, edge case)
- [ ] T100 [P] [US3] Build the staleness banner stating when the figures were retrieved, using status styling that touches neither `--color-gain` nor `--color-loss` (research Part C), and the distinct "not available offline" empty state
- [ ] T101 [P] [US3] Add the PWA manifest and icons so the app is installable and launches without a connection (FR-035a)
- [ ] T102 [US3] Purge every cache and the persisted tRPC client store on sign-out (FR-035e)

**Checkpoint**: The product's core value is delivered. A monthly-only planner is usable on a phone, online and offline.

---

## Phase 6: User Story 4 — Handle payments that are not monthly (Priority: P4)

**Goal**: Quarterly, half-yearly, yearly and one-off commitments project
correctly in both a smoothed and a cash presentation.

**Independent Test**: A quarterly commitment of 66,03 € anchored to January shows
22,01 € in every smoothed month, 66,03 € in the cash view in January, April, July
and October and nothing in the other months, and both views total 264,12 € over
twelve months.

### Tests for User Story 4 (write first, observe failing)

- [ ] T103 [P] [US4] `packages/core/tests/projection/due-months.test.ts`: period lengths 1, 3, 6, 12; due months are `anchor + k * period` with **negative `k` permitted**, restricted to active months, so an anchor before the start date yields no due month until the first occurrence on or after the start month (FR-029, edge case). `one_off` is due in exactly its anchor month if active, and is never smoothed (Story 4 scenario 7)
- [ ] T104 [P] [US4] `packages/core/tests/projection/period-window.test.ts`: `periodStart = anchor + floor((m - anchor) / period) * period` with a **true floor, not truncation toward zero**, so months before the anchor land in the correct earlier period — an explicit test case (research B4)
- [ ] T105 [P] [US4] `packages/core/tests/projection/smoothing.test.ts`: allocate across the full period, then clip to active months (FR-028a). The spec's worked example — quarterly 240,00 € anchored to January, ending in February — yields January 80,00 €, February 80,00 €, March omitted, cash view 240,00 € in January. Smoothed and cash totals are asserted equal **only** over fully covered periods; the partially covered case asserts the documented inequality, never equality (FR-028b)
- [ ] T106 [P] [US4] `packages/core/tests/projection/exactness.test.ts`: over ≥1 000 generated amount-and-period combinations, the smoothed months of one fully covered period sum to exactly the charge — never a cent gained or lost (SC-002, Story 4 scenario 4)
- [ ] T107 [P] [US4] `apps/web/tests/e2e/us4-rhythms.spec.ts`: the 66,03 €-quarterly scenario end to end in both presentations; the anchor-missing refusal; the chosen presentation retained across month navigation and across a session restart (FR-030, Story 4 scenario 6); axe scan

### Implementation for User Story 4

- [ ] T108 [P] [US4] Implement `packages/core/src/projection/rhythm.ts` — period length per rhythm, with `one_off` modelled as a distinct rhythm rather than a period (research B3)
- [ ] T109 [P] [US4] Implement `packages/core/src/projection/due-months.ts`
- [ ] T110 [US4] Implement `packages/core/src/projection/period-window.ts` and `smoothing.ts` on `allocate` from T021 — the allocation is never re-derived locally
- [ ] T111 [US4] Extend T093's aggregation to route each commitment through the cash or smoothed path per the requested presentation, and set `isDue` on every expense line
- [ ] T112 [P] [US4] Build the presentation toggle on `.seg`, persisted client-side across navigation and sessions, never as server state, so a shared cache entry cannot be poisoned by another device's preference (FR-030)
- [ ] T113 [P] [US4] Surface the presentation in the UI with an explanation of what a smoothed figure means, since FR-028b makes the two views legitimately disagree over partially covered periods

**Checkpoint**: Non-monthly commitments are correct in both presentations. Roughly a sixth of the user's data becomes trustworthy.

---

## Phase 7: User Story 5 — Separate money set aside from money spent (Priority: P5)

**Goal**: Reserve commitments report separately from expenses, including inside a
category that holds both.

**Independent Test**: Mark one commitment inside an otherwise-expense category as
a reserve; verify it leaves that category's expense total, joins the reserves
total, and that expenses plus reserves equals the previous combined total.

### Tests for User Story 5 (write first, observe failing)

- [ ] T114 [P] [US5] `packages/core/tests/dashboard/reserves.test.ts`: a reserve contributes to `reservesTotal` and never to `expenseTotal` or to an expense category total (FR-032); a category holding both kinds appears in both lists with the matching subset of lines (Story 5 scenario 2); `expenseTotal + reservesTotal === combinedTotal === the sum of all outgoing commitments` — asserted, not merely intended (Story 5 scenario 3)
- [ ] T115 [P] [US5] `apps/web/tests/e2e/us5-reserves.spec.ts`: flip a commitment's kind, reopen the dashboard, and assert every affected total moves (Story 5 scenario 4); axe scan

### Implementation for User Story 5

- [ ] T116 [US5] Extend T093's aggregation with `reserveCategories`, `reservesTotal` and `combinedTotal`, splitting on `kind`
- [ ] T117 [P] [US5] Add the reserve/expense control to the commitment form, defaulting to expense (FR-018)
- [ ] T118 [P] [US5] Build the reserves section on the dashboard, distinguished from expenses by a label and a `.pill`, using neither `--color-gain` nor `--color-loss` — the distinction is status, not money direction (research Part C, FR-043)

**Checkpoint**: The headline expense figure is no longer overstated by savings.

---

## Phase 8: User Story 6 — Know what to transfer between my accounts (Priority: P6)

**Goal**: For a chosen month, a list of destination accounts and the amounts to
move to each, with every displayed line individually transferable.

**Independent Test**: Three commitments targeting one destination and one
targeting another produce two destinations with correct sums for the month.

### Tests for User Story 6 (write first, observe failing)

- [ ] T119 [P] [US6] `packages/core/tests/transfers/month.test.ts`: each destination appears once with the sum of the amounts routed to it; a commitment with no destination never appears (FR-038); `sharePercent = 0` appears with amount zero while still counting in category totals (edge case); a 40,01 € commitment at 50% reads 20,01 € and the destination total contains exactly that figure (Story 6 scenario 6)
- [ ] T120 [P] [US6] `packages/core/tests/transfers/totals.test.ts`: a destination total is the plain sum of its already-rounded lines, with no reconciling difference (FR-039b), and may exceed the exact mathematical total when several lines round up — accepted, because every line must be transferable (edge case)
- [ ] T121 [P] [US6] `packages/api/tests/transfers-month.test.ts`: no `presentation` parameter exists; transfers are always computed from the cash view (OQ-2), and `MONTH_OUT_OF_HORIZON` applies
- [ ] T122 [P] [US6] `apps/web/tests/e2e/us6-transfers.spec.ts`: the two-destination fixture; the explanatory empty state for a month that routes nothing (Story 6 scenario 5); axe scan

### Implementation for User Story 6

- [ ] T123 [US6] Implement `packages/core/src/transfers/month.ts` on `applyShare` from T023 — the share is rounded in that one function and nowhere else
- [ ] T124 [US6] Implement `packages/api/src/routers/transfers.ts` — `transfers.month`, cash view only
- [ ] T125 [P] [US6] Build the transfers screen in `apps/web/app/(app)/transfers/`, showing each destination with its lines, each line's full charge, its share percent and its transferable amount
- [ ] T126 [P] [US6] Add the empty state and the month navigator, reusing T096 rather than duplicating it

**Checkpoint**: The task the spreadsheet performs worst is replaced.

---

## Phase 9: User Story 7 — Contract start, end and notice deadlines (Priority: P7)

**Goal**: Projections stop when a contract does, and the cancellation deadline is
visible without opening the record.

**Independent Test**: A commitment with an end date inside the horizon is included
up to and including that month and absent from every month after it.

### Tests for User Story 7 (write first, observe failing)

- [ ] T127 [P] [US7] `packages/core/tests/time/boundaries.test.ts`: months before the start month exclude the commitment; the month containing a 15 March start includes it at full amount; months after the end month exclude it and every total drops it; a commitment starting and ending inside one month counts for that month in full (FR-026, FR-026a, edge case)
- [ ] T128 [P] [US7] `apps/web/tests/e2e/us7-contracts.spec.ts`: the notice deadline and the description are both visible in the commitment list without opening the record (Story 7 scenarios 4 and 6); `END_BEFORE_START` is explained inline; dates render in German locale conventions; axe scan

### Implementation for User Story 7

- [ ] T129 [P] [US7] Add `endDate`, `noticeDeadline` and `description` to the commitment form with inline validation, and confirm the projection boundaries already hold from T092
- [ ] T130 [P] [US7] Include `noticeDeadline` and `description` in the `commitments.list` payload so both are satisfiable without a second request ([contracts/procedures.md](./contracts/procedures.md))
- [ ] T131 [P] [US7] Display the deadline in the list with an approaching-deadline `.pill`, conveying urgency by label as well as colour and sending no notification — notifications are out of scope (FR-012, FR-043)

**Checkpoint**: Projections are correct for anything that does not run forever.

---

## Phase 10: User Story 8 — Amounts that change over time (Priority: P8)

**Goal**: An amount is valid from a date, a single month can be overridden, and
editing an amount never rewrites history.

**Independent Test**: 900,00 € from January and 945,00 € from June — May shows
900,00 €, June shows 945,00 €. Override March to 0,00 € and only March changes.

### Tests for User Story 8 (write first, observe failing)

- [ ] T132 [P] [US8] `packages/core/tests/amounts/in-force.test.ts`: the amount in force for a **due** month is the greatest effective month less than or equal to it; selecting on the due month rather than the displayed month is what keeps a smoothed view internally consistent — one charge, one amount, then divided (research B6, FR-021, FR-026b)
- [ ] T133 [P] [US8] `packages/core/tests/amounts/overrides.test.ts`: an override replaces the charge for the month it names; removing it reverts to the amount in force; an override on an inactive month is rejected (FR-024); an override on a non-due month of a non-monthly commitment is rejected with `MONTH_NOT_DUE`, because there is no charge to replace and treating it as a smoothed share would break FR-028's exact-sum guarantee (OQ-1)
- [ ] T134 [P] [US8] `packages/api/tests/amounts.test.ts`: `EFFECTIVE_MONTH_TAKEN` for two effective dates in the same calendar month (edge case); `NEGATIVE_AMOUNT`; `LAST_AMOUNT` when removing the only amount; `AMOUNT_GAP` when a removal would leave the earliest active months uncovered; a second override of one month replaces the first with no duplicate (edge case)
- [ ] T135 [P] [US8] `apps/web/tests/e2e/us8-amount-history.spec.ts`: the independent-test scenario end to end, plus the assertion that changing a current amount leaves earlier months unchanged (Story 8 scenario 5); axe scan

### Implementation for User Story 8

- [ ] T136 [P] [US8] Implement `packages/core/src/amounts/in-force.ts` and `overrides.ts`
- [ ] T137 [US8] Implement `packages/api/src/routers/amounts.ts` — `add`, `update`, `remove`
- [ ] T138 [US8] Implement `packages/api/src/routers/overrides.ts` — `set` as an upsert on `(commitmentId, month)`, and `remove`
- [ ] T139 [US8] Return `dueMonths` from `commitments.get` within the current horizon, so the override form can restrict the picker and make the OQ-1 rule discoverable rather than a surprise error
- [ ] T140 [P] [US8] Build the amount-history panel and the override editor in `apps/web/app/(app)/commitments/[id]/`, with the month picker restricted to `dueMonths` and `MONTH_NOT_DUE` left in place as a backstop for the OpenAPI client
- [ ] T141 [US8] Confirm the aggregation from T093 and T111 reads amounts through T136 for every month, and that no month's figure is computed from a commitment's "current" amount

**Checkpoint**: Past months stay truthful. The user's month-by-month variation is representable.

---

## Phase 11: User Story 9 — Take my data out, or remove it entirely (Priority: P9)

**Goal**: A complete machine-readable export, and account deletion that is
genuine erasure.

**Independent Test**: Populate a workspace, export it, verify every entity and
field is present; then delete the account and verify no data remains reachable in
any store.

### Tests for User Story 9 (write first, observe failing)

- [ ] T142 [P] [US9] `packages/api/tests/data-rights-export.test.ts`: the export contains every field of every record the workspace holds, compared field by field against a populated fixture, and contains no `password_hash` and no session data (SC-008, FR-040)
- [ ] T143 [P] [US9] `packages/api/tests/data-rights-delete.test.ts`: deletion requires re-authentication; it cascades to every tenant-scoped table in one transaction with no soft-delete flag anywhere; afterwards every previously valid identifier returns `NOT_FOUND` (FR-041, SC-009, Story 9 scenario 3)
- [ ] T144 [P] [US9] `packages/api/tests/data-rights-audit.test.ts`: `export_performed` and `account_deleted` are recorded, and the retained `account_deleted` row has `workspace_id` and `user_id` set to `null` so it carries no personal data while remaining append-only (FR-006, Article VIII)
- [ ] T145 [P] [US9] `apps/web/tests/e2e/us9-data-rights.spec.ts`: export and inspect the file; then delete the account, assert sign-out, assert every cache is gone from the device, and reuse the identifiers captured before deletion to assert nothing is reachable (SC-009); axe scan

### Implementation for User Story 9

- [ ] T146 [US9] Implement `dataRights.export` in `packages/api/src/routers/dataRights.ts`, emitting `schemaVersion: 1` with workspace, users, accounts, categories, commitments, amounts and overrides
- [ ] T147 [US9] Implement `dataRights.deleteAccount`: re-authentication, one transaction, the workspace row deleted and cascaded, the audit row nulled, the cookie cleared
- [ ] T148 [P] [US9] Build the export and delete-account flows in `apps/web/app/(app)/settings/`, with a confirmation that states the deletion is irreversible and requires the password
- [ ] T149 [US9] Purge every cache and the persisted client store on deletion, on the same path as sign-out from T102 (FR-035e, SC-009)

**Checkpoint**: All nine stories are independently functional.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [ ] T150 [P] Handle a very long commitment or category name on a narrow screen: truncated with the full value still reachable, never overlapping a figure (edge case)
- [ ] T151 [P] Record the keyboard-only traversal and screen-reader pass for each new interactive pattern — month navigator, presentation toggle, commitment form, override editor, delete confirmation — in the pull request, as Article IV requires. Automated scans catch a minority of violations
- [ ] T152 [P] Add the Playwright performance assertions for SC-006 (2 s first dashboard render, 1 s month switch on a mid-range mobile profile) and SC-011 (2 s offline render)
- [ ] T153 [P] Verify the coverage floors are met rather than merely configured: 90% lines and branches in `packages/core`, 70% repo-wide. A test that asserts nothing meaningful is a defect regardless of its effect on the number (Article III). **Includes re-adding `apps/web` to `coverage.include`**, removed during Phase 2 because the V8 provider emits `PARSE_ERROR` on JSX and type-only imports in never-executed files and drops them from the calculation silently — the floor must not claim to cover files it cannot parse, so `apps/web` rejoins it together with the component test setup that gives it a transform
- [ ] T154 [P] Add dependency vulnerability scanning and automated update pull requests ("Baseline security controls")
- [ ] T155 [P] Assert no `any` and no non-null assertion on any security path — session handling, workspace scoping, password verification ("Baseline security controls")
- [ ] T156 [P] Audit application logs and error payloads for a monetary amount, an account identifier, an email address or any personal data, and add a test asserting their absence (Article VIII)
- [ ] T157 Run [quickstart.md](./quickstart.md) end to end on a fresh clone; every command must pass unmodified. If one does not, the defect is in the repository, not in the document
- [ ] T158 Update `PROMOTE.md` with the final use count for `Table`, `DatePicker`, `Select` and `Modal`, in the same commit that makes it stale (Article V, "Currency of documentation")
- [ ] T159 **SC-001 acceptance**: enter the real spreadsheet — roughly 130 commitments, 13 categories, 8 incomes, 4 accounts — and reconcile each of the 13 category totals for one chosen month against the source spreadsheet to the cent (the file itself is gitignored and stays off this repository). A mismatch is a defect in the projection, and the first commit fixing it must be a failing test that reproduces it (Article III)
- [ ] T160 **SC-003 acceptance**: reconcile the transfer list for that month against the amounts the user currently transfers by hand, excluding destinations that depend on a second person's share or whose current figure the user deliberately rounds up to whole euros — that buffer rounding is explicitly out of scope
- [ ] T161 **SC-010 acceptance**: the user completes one full month of planning without opening the spreadsheet. This is the feature's real exit criterion; every other measure is a proxy for it
- [ ] T162 Write the pull request description stating which articles the feature touches and how each is satisfied, per "Pull requests". A PR changing a monetary calculation, an RLS policy or an authentication path requires human review that must not be waived on the grounds that tests pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T016 and T017 are spikes whose results feed T033 and T098 respectively, so start them early.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US1 (Phase 3)**: depends on Foundational. Blocks every other story — not for technical reasons but constitutional ones: Story 1's own rationale states nothing else may be built before isolation holds.
- **US2 (Phase 4)**: depends on US1. Blocks US3–US8, which all read commitment data.
- **US3 (Phase 5)**: depends on US2.
- **US4–US8 (Phases 6–10)**: depend on US3's aggregation function, which they extend. They are independently testable but not independently deployable ahead of US3.
- **US9 (Phase 11)**: depends on US2 for entities worth exporting; independent of US3–US8.
- **Polish (Phase 12)**: depends on the stories being delivered.

### Within Each User Story

- Tests are written first and observed to fail for the intended reason.
- Migrations before schema types; schema types before repositories; domain functions before the procedures that call them; procedures before screens.
- `packages/core` before `packages/api` before `apps/web`, always — the transport boundary is also the build order.

### Parallel Opportunities

- T002–T014 are almost entirely `[P]`: different files, no shared state.
- The `packages/core` primitive pairs in Phase 2 (T018–T027) are fully parallel across five files.
- The auth package tasks T053–T058 are parallel with the transport tasks T037–T047.
- Within each story, every test task marked `[P]` can be written simultaneously.
- US9 can be built in parallel with US4–US8 once US2 is done.

### Sequential by necessity

- T016 → T033: the migration's month-index shape depends on the verification result.
- T017 → T098: the service worker cannot cache queries that are not `GET`.
- T021 → T110 and T023 → T123: allocation and share rounding exist once each, and are called, never re-derived.
- T093 → T111 → T116 → T141: the aggregation function is extended four times by four stories. Sequential, single file, no `[P]`.

---

## Parallel Example: Phase 2 domain primitives

```bash
# Write all five failing test files together:
Task: "packages/core/tests/money/money.test.ts"
Task: "packages/core/tests/money/allocate.test.ts"
Task: "packages/core/tests/money/apply-share.test.ts"
Task: "packages/core/tests/time/year-month.test.ts"
Task: "packages/core/tests/money/percentage.test.ts"

# Observe all five fail, then implement all five together:
Task: "packages/core/src/money/money.ts"
Task: "packages/core/src/money/allocate.ts"
Task: "packages/core/src/money/apply-share.ts"
Task: "packages/core/src/time/year-month.ts"
Task: "packages/core/src/money/percentage.ts"
```

---

## Implementation Strategy

### MVP

Setup → Foundational → US1 → US2 → US3. At that point the user has an isolated,
installable, offline-readable planner for monthly commitments, which is the
dashboard they open repeatedly. Stop and validate before US4.

### Incremental delivery

1. Setup + Foundational — the gates are live and red for absence of code.
2. US1 — isolation holds, proven per table against real PostgreSQL.
3. US2 — data exists.
4. US3 — **MVP**: the core value, on a phone, online and offline.
5. US4 — non-monthly rhythms; roughly a sixth of the data becomes trustworthy.
6. US5 — the expense figure stops being overstated.
7. US6 — the transfer list, the strongest reason to abandon the spreadsheet.
8. US7 — contract boundaries and deadlines.
9. US8 — amount history; past months stay truthful.
10. US9 — export and erasure. Legally required before the first real user, so it
    must not slip past the first release that stores real data (Article VIII).

### Notes

- Commit after each task or logical pair. A failing test and its implementation are a natural pair.
- OQ-1 and OQ-2 in [plan.md](./plan.md#open-questions-and-owed-verifications) are implemented as the defaults chosen there. Reversing OQ-1 requires amending FR-028 first; reversing OQ-2 is a spec change. Neither is a code-level decision.
- No task in this list may be satisfied by disabling, skipping or weakening a test, lint rule, type check or CI gate (Article IX).
