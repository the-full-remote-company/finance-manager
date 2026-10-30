---
description: "Task list for 002-email-verification"
---

# Tasks: Email Verification for Registration

**Input**: Design documents from `/specs/002-email-verification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: MANDATORY, not optional. This feature touches the authentication path. Per ADR 0003, every change requires strict red-green-refactor and mandatory human review. Article IX forbids weakening any of it.

**Organization**: Grouped by user story (US1–US4) matching the spec's priorities. Each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to
- **TDD pairs**: a task labelled *(test first)* MUST be observed to fail for the intended reason before its implementation task begins

## Path Conventions

Monorepo layout from [plan.md](./plan.md#project-structure): `packages/core`, `packages/db`, `packages/api`, `packages/auth`, `packages/ui`, `apps/web`.

---

## Phase 1: Setup (Preparation)

**Purpose**: Database migration, schema changes, and SMTP configuration.

- [x] T001 Add `nodemailer` to `packages/auth/package.json` and update type definitions (originally 6.9; see T060)
- [x] T002 [P] Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` to `.env.example`
- [x] T003 [P] Add Mailpit service to `docker-compose.yml` for local development: port 1025 (SMTP), port 8025 (web UI)
- [x] T004 Write migration `00XX-add-email-confirmation.sql` per [data-model.md](./data-model.md): add `confirmed` and `confirmed_at` to `users`, create `confirmation_tokens` table with RLS, grant to `app` role, UPDATE existing rows to `confirmed = true` with `confirmed_at = now()` (FR-019)
- [x] T005 [P] Write `packages/db/src/schema/confirmation-tokens.ts`: Drizzle schema per [data-model.md](./data-model.md), export inferred types
- [x] T006 [P] Update `packages/db/src/schema/workspaces.ts` (users table): add `confirmed` boolean and `confirmed_at` timestamptz columns to the Drizzle schema
- [x] T007 [P] Write `scripts/send-test-email.ts`: dev tool that reads SMTP config from env and sends a test email, for verifying local Mailpit and production provider setup

**Checkpoint**: Migration runs, schema is updated, local Mailpit receives test emails.

---

## Phase 2: Token and Email Infrastructure (Test-First)

**Purpose**: Confirmation token generation, hashing, validation, and email send interface. Strict TDD per Article III.

### Tests (write first, observe failing)

- [x] T008 [P] *(test first)* `packages/auth/tests/confirm-token.test.ts`: issue a token (128-bit random, SHA-256 hash stored, 24hr expiry); verify with correct token succeeds, wrong token fails, expired token fails, superseded token (superseded_at set) fails; token hash is never logged; raw token never appears in any output
- [x] T009 [P] *(test first)* `packages/auth/tests/email.test.ts`: email send interface returns success on send, logs but does not throw on SMTP failure; no token, password, or personal data appears in logs; email body contains the confirmation link in plain text German

### Implementation

- [x] T010 [P] Implement `packages/auth/src/confirm-token.ts`: `issueConfirmToken()` (generates raw token, returns hash + raw), `verifyConfirmToken(hash)` (checks expiry + superseded_at), `supersedePreviousTokens(userId)` (sets superseded_at on all tokens for user). No floating-point, SHA-256 via Node crypto, 24hr expiry constant
- [x] T011 [P] Implement `packages/auth/src/email.ts`: interface wrapping `nodemailer`, reads SMTP config from env, sends plain-text German confirmation email with link, catches send errors and logs them without throwing (FR-017). No HTML template engine introduced.
- [x] T012 Confirmation email text: German, plain text, contains the link, explains the 24hr expiry. Inlined in `packages/auth/src/email.ts` rather than a separate template file, because one message does not justify a template loader; covered by `packages/auth/tests/email.unit.test.ts`

**Checkpoint**: Token issue/verify works, email send interface works against Mailpit.

---

## Phase 3: User Story 1 — Confirm email before first use (Priority: P1) 🎯

**Goal**: A new person registers, receives a confirmation email, clicks the link, and is signed in. Until they click, they have no session and cannot reach workspace data.

**Independent Test**: Register a new address, verify no session cookie is set and `/dashboard` is not reachable. Open the link from the email, verify the account is confirmed, a session is created, and the browser lands on `/dashboard`.

### Tests (write first, observe failing)

- [x] T013 [P] [US1] *(test first)* `packages/db/tests/isolation/confirmation-tokens.test.ts`: apply the cross-tenant leak test harness (from feature 001 T030) to `confirmation_tokens` — workspace A cannot read/update/delete workspace B's tokens (Article I)
- [x] T014 [P] [US1] *(test first)* `packages/api/tests/auth/register-confirmation.test.ts`: registration creates unconfirmed user, no session cookie set, confirmation token issued, email send called; duplicate email returns same response shape and timing class, no session, no email sent (FR-001, FR-011)
- [x] T015 [P] [US1] *(test first)* `packages/api/tests/auth/confirm.test.ts`: valid token confirms account and creates session; expired token returns `TOKEN_INVALID`; already-used token returns `TOKEN_INVALID`; already-confirmed account returns `ALREADY_CONFIRMED`; wrong token returns `TOKEN_INVALID` (FR-005, FR-007)
- [x] T016 [P] [US1] *(test first)* `packages/api/tests/auth/audit-confirmation.test.ts`: confirmation appends `account_confirmed` with workspace/user/ip on success, appends `confirmation_failed` on failure; no email address or token in audit events (FR-015, Article VIII)
- [x] T017 [P] [US1] `apps/web/tests/e2e/us1-register-confirm.spec.ts`: register, check Mailpit for email (via its API if available, or via UI scrape), extract link, open it, click "Confirm account" button (not automatic on page load), verify session created and redirected to `/dashboard`; axe scan on success screen and confirm page

### Implementation

- [x] T018 [US1] Modify `packages/api/src/routers/auth.ts` — `register`: create unconfirmed user (confirmed=false), issue token, call email send, do NOT create session or set cookie; preserve enumeration resistance (password hashing before collision check, duplicate returns same shape)
- [x] T019 [US1] Add `packages/api/src/routers/auth.ts` — `confirm` procedure per [contracts/procedures.md](./contracts/procedures.md): verify token, check expiry + superseded_at + user still unconfirmed, set confirmed=true + confirmed_at=now(), create session, set cookie, append audit event, return workspace+user IDs
- [x] T020 [P] [US1] Build `/confirm?token=...` page in `apps/web/app/(auth)/confirm/page.tsx`: extracts token from query param, button calls `auth.confirm` on press (FR-006, not on page load). On success, router.push("/dashboard"). On TOKEN_INVALID (and a missing token), show the error plus an inline resend form (this is T028). On ALREADY_CONFIRMED, auto-redirect to sign-in. *Amended*: the page does not display the account's email. Neither the spec nor `contracts/procedures.md` asks for it (the address is shown on the register success screen, spec scenario 2), and it would need a new unauthenticated token-to-email lookup, an enumeration oracle nobody specified.
- [x] T021 [P] [US1] Rewrite success screen in `apps/web/app/(auth)/register/page.tsx`: show email address, "Check your email for confirmation link" copy, "Resend confirmation email" button (calls `auth.resendConfirmation`), NO router.prefetch (the FR-013 bug fix). No layout/nav issue because this is a real screen now, not a bare `<p>` (FR-012, FR-013, FR-014).
- [x] T022 [US1] Update `apps/web/messages/de.json`: new strings for confirm flow, success screen, resend button, TOKEN_INVALID error, ALREADY_CONFIRMED message. Fix the misleading copy (FR-014).

**Checkpoint**: US1 works end-to-end. Registration → email → confirm → dashboard.

---

## Phase 4: User Story 2 — Resend a confirmation email (Priority: P2)

**Goal**: A person who did not receive the email, or whose link expired, can request a new one.

**Independent Test**: Register, do not click the link, request a resend, verify a new link is emailed, the previous link stops working, and repeated resend requests are throttled.

### Tests (write first, observe failing)

- [x] T023 [P] [US2] *(test first)* `packages/api/tests/auth/resend-confirmation.test.ts`: resend for unconfirmed account supersedes all previous tokens and sends new email; resend for confirmed account returns same response, no email sent; resend for unknown email returns same response, no email sent; repeated resends are rate-limited (FR-008, FR-009, FR-010) *Evidence*: written against the existing `resendConfirmation`, so 15 of 16 passed on first run and could not be seen failing; the one that failed (a rejecting mailer made the request reject) is what led to ADR 0011
- [x] T024 [P] [US2] *(test first)* `packages/api/tests/auth/resend-timing.test.ts`: property test asserting resend response for unknown/confirmed/unconfirmed emails falls in the same timing class (enumeration resistance, FR-009) *Evidence*: red first (unconfirmed median 155.6 ms vs 1.7 ms awaiting a 150 ms send), green after ADR 0011 (3.0 to 4.0 ms vs 0.9 to 1.3 ms)
- [x] T025 [P] [US2] `apps/web/tests/e2e/us2-resend.spec.ts`: register, open success screen, click "Resend", check Mailpit for second email with different token, verify first token returns TOKEN_INVALID, second token confirms account; axe scan on resend UI

### Implementation

- [x] T026 [US2] Add `packages/api/src/routers/auth.ts` — `resendConfirmation` procedure per [contracts/procedures.md](./contracts/procedures.md): look up email, if unconfirmed call supersedePreviousTokens, issue new token, send email; if confirmed or unknown, return same response without sending; rate-limit via auth_attempts (FR-008, FR-009, FR-010)
- [x] T027 [P] [US2] Wire resend button in `apps/web/app/(auth)/register/page.tsx` (already present from T021) to call `auth.resendConfirmation` with the email the user just registered
- [x] T028 [P] [US2] Build resend form in `/confirm` page for TOKEN_INVALID case: user enters email, calls `auth.resendConfirmation`, shows "Check your email" on success (FR-007)

**Checkpoint**: US2 works. Resend flow is fully functional and enumeration-resistant.

---

## Phase 5: User Story 3 — Registration does not reveal existing accounts (Priority: P1)

**Goal**: Registering a duplicate email (confirmed or unconfirmed) looks identical to registering a new address.

**Independent Test**: Compare registration response and timing for new/confirmed/unconfirmed addresses. Response shape must be identical, timing must fall in the same class.

### Tests (write first, observe failing)

- [x] T029 [P] [US3] *(test first)* `packages/api/tests/auth/register-enumeration.test.ts`: register new address, confirmed address, unconfirmed address; all return same shape `{ userId, workspaceId }`; timing differs by no more than normal argon2id variance (measure 10 runs of each, compare distributions); no session created for duplicates (FR-011) *Evidence*: red first (new 169.1 ms vs duplicate 17 to 20 ms), green after ADR 0011 (13.6 to 16.1 vs 12.9 to 15.2)
- [x] T030 [P] [US3] *(test first)* `packages/api/tests/auth/register-duplicate-behavior.test.ts`: registering a duplicate confirmed email sends no email; registering a duplicate unconfirmed email sends no email (not even a "your email was already registered" notice to the owner); no audit event for duplicate (FR-011) *Evidence*: the duplicate path already behaved this way, so these passed on first run and could not be seen failing
- [x] T031 [P] [US3] `apps/web/tests/e2e/us3-enumeration.spec.ts`: register alice@example.com, confirm it, attempt to register alice@example.com again, verify response looks identical to first registration (user sees success screen), check Mailpit to confirm no second email sent

### Implementation

- [x] T032 [US3] Verify `packages/api/src/routers/auth.ts` — `register`: password hashing happens before unique constraint check (already implemented in feature 001, unchanged), duplicate email returns `{ userId: randomUUID(), workspaceId: randomUUID() }` (fake IDs, same shape), no session, no email send, timing indistinguishable (FR-011). No code change needed if T014 is correct; this task is verification + documentation. Done: each ADR 0003 property is mapped to the test that asserts it in [ADR 0011](../../decisions/0011-confirmation-email-is-sent-after-the-response.md); the code did change (token issued on every path, one transaction)

**Checkpoint**: US3 verified. Enumeration resistance holds across confirmation states.

---

## Phase 6: User Story 4 — Confirmed accounts behave as today (Priority: P2)

**Goal**: Once confirmed, an account signs in, signs out, and uses the app exactly as before this feature.

**Independent Test**: Run the existing sign-in, sign-out, and session-expiry scenarios from feature 001 against a confirmed account. All must pass unchanged.

### Tests (write first, observe failing)

- [x] T033 [P] [US4] *(test first)* `packages/api/tests/auth/sign-in-confirmed.test.ts`: sign in with confirmed account and correct password creates session as before; sign in with confirmed account and wrong password returns AUTH_FAILED as before (FR-020)
- [x] T034 [P] [US4] *(test first)* `packages/api/tests/auth/sign-in-unconfirmed.test.ts`: sign in with unconfirmed account and correct password returns ACCOUNT_NOT_CONFIRMED; sign in with unconfirmed account and wrong password returns AUTH_FAILED (not ACCOUNT_NOT_CONFIRMED, enumeration resistance) (FR-020)
- [x] T035 [P] [US4] `apps/web/tests/e2e/us4-confirmed-sign-in.spec.ts`: register + confirm, sign out, sign in again, verify session restored and dashboard accessible; run subset of feature 001's US1 isolation test against confirmed account (no regression)

### Implementation

- [x] T036 [US4] Modify `packages/api/src/routers/auth.ts` — `signIn`: after password verification succeeds, check `users.confirmed`; if false, append sign_in_failed audit event and return ACCOUNT_NOT_CONFIRMED error with email in details; if true, proceed as before (create session, return workspaceId); if password wrong, return AUTH_FAILED regardless of confirmation state (FR-020)
- [x] T037 [P] [US4] Build unconfirmed account screen in `apps/web/app/(auth)/sign-in/page.tsx`: handle ACCOUNT_NOT_CONFIRMED error, display "Account not confirmed" with email, offer "Resend confirmation email" button calling `auth.resendConfirmation` Exercised by `us4-confirmed-sign-in.spec.ts` and `sign-in-unconfirmed.test.ts`
- [x] T038 [P] [US4] Update `apps/web/messages/de.json`: ACCOUNT_NOT_CONFIRMED error copy in German (FR-014)

**Checkpoint**: US4 works. Confirmed accounts behave exactly as in feature 001. Unconfirmed accounts are handled gracefully at sign-in.

---

## Phase 7: Migration Verification and Edge Cases

**Purpose**: Verify the migration works on existing data and edge cases are handled.

- [x] T039 [P] *(test first)* `packages/db/tests/migrations/email-confirmation.test.ts`: seed a users table with 3 users (from feature 001 state), run migration 00XX, assert all 3 have confirmed=true and confirmed_at≈migration time; new registrations create confirmed=false (FR-019) *Evidence*: runs the migrations on a scratch database holding three feature-001 accounts; flipping `DEFAULT true` to `false` turns two tests red, restored afterwards
- [x] T040 Test edge case: token opened in different browser from registration. Verify: token still works, session created in opening browser, original browser has no session until sign-in. Covered by `confirm.test.ts` and `us1-register-confirm.spec.ts` (second browser context)
- [x] T041 Test edge case: two tokens exist (after resend), only newest is valid. Verify: first token returns TOKEN_INVALID, second token confirms account. Covered by `confirm.test.ts` (superseded token) and `us2-resend.spec.ts`
- [x] T042 Test edge case: SMTP provider unreachable at registration. Verify: account created, user sees success screen, resend works once provider recovers, failed send logged (not shown to user) (FR-017). *Evidence*: real mailer against a closed port and against a server that accepts and never speaks; making registration await the send again turns `mail-hang` red at 8039 ms, restored afterwards
- [x] T043 Test edge case: confirmation link opened after account was deleted. Verify: TOKEN_INVALID response (same as expired token). Covered by `confirm.test.ts` (workspace deleted)
- [x] T044 Test edge case: link preview/mail scanner opens confirm page. Verify: page loads without consuming token (no auto-confirm on page load per FR-006), explicit button press required. Covered by `us1-register-confirm.spec.ts` (repeated GET and reload leave the token unconsumed)

**Checkpoint**: Migration verified, all edge cases covered.

---

## Phase 8: Integration and Cleanup

**Purpose**: Wire everything together, update documentation, verify all tests green.

- [x] T045 Run full test suite: `pnpm test:unit && pnpm test:integration && pnpm test:isolation && pnpm test:e2e` — all green Last run: 176 unit, 61 isolation, 210 integration, 76 e2e (2 skipped by design), 2 workers and 1
- [x] T046 Run `pnpm openapi:check` — regenerated document includes auth.confirm and auth.resendConfirmation, no drift Document unchanged by this phase; passes once committed
- [x] T047 Update `specs/001-recurring-budget-planner/contracts/procedures.md` if auth.register or auth.signIn changed (mark as MODIFIED in 002 contracts, but maintain feature 001 docs as source of truth for non-email features) 001's `register` and `signIn` entries now point at 002
- [x] T048 Verify `pnpm lint`, `pnpm typecheck`, `pnpm format` all pass
- [x] T049 Verify coverage floors: 90% in packages/core (no core changes expected), 70% repo-wide (auth changes covered) 89.68 % lines repo-wide (floor 70); `packages/core` untouched
- [x] T050 Retire `HANDOFF.md`, which is not a spec-kit artifact (`tasks.md` checkboxes are the resume state). Its durable content moved: the service-worker lesson to [ADR 0010](../../decisions/0010-service-worker-cache-invalidation.md), the `core` conventions to feature 001's `plan.md` structure notes, the commands and the `--workers=1` note to feature 001's `quickstart.md`, the worker-tsconfig note to the comment in `eslint.config.js`. Feature 001's resume point is its own `tasks.md`: T119
- [x] T051 [P] Write `specs/002-email-verification/quickstart.md`: local Mailpit setup, SMTP env vars for Postmark/AWS SES, how to test confirmation flow locally, how to verify an account is confirmed vs unconfirmed
- [x] T052 [P] Document the two registration-screen bug fixes in the commit message or PR description: `router.prefetch`→navigation (FR-013, T021), misleading German copy (FR-014, T022) Done in PR #1's description

**Checkpoint**: Feature complete, all tests green, documentation updated.

---

## Phase 9: Defects and follow-ups found while verifying Phase 3

**Purpose**: Work that was not in the original breakdown and was discovered by running the tests against the real database. Recorded so the task list stays the source of truth.

- [x] T053 Register migrations 0005 and 0006 in `packages/db/migrations/meta/_journal.json` (they were on disk but never applied), give 0005 the same `nullif(current_setting('app.workspace_id', true), '')` policy predicate and `--> statement-breakpoint` markers as every other migration, and add `0007_confirmation_audit_events.sql` (the `audit_event_type` enum lacked `account_confirmed`, `confirmation_resent`, `confirmation_failed`, so the first confirmation would have thrown)
- [x] T054 `auth.confirm` could never succeed: it queried `confirmation_tokens` with no workspace set, under forced RLS. Fixed by carrying the workspace id in the link and scoping the lookup to it, with no new `SECURITY DEFINER` function ([ADR 0009](../../decisions/0009-confirmation-link-carries-workspace.md)); `auth.resendConfirmation` reuses `app_authenticate`. Also: single transaction with `for update`, `confirmation_failed` audited, `packages/auth/tests/confirm-token-link.unit.test.ts`
- [x] T055 Repair what feature 002's "register issues no session" broke in feature 001's tests: a shared `packages/api/tests/support/session.ts` for five API fixtures, `sign-in`/`register`/`throttle` expectations, the error-catalogue and exempt-procedure guards, the OpenAPI document, and a shared `apps/web/tests/support/account.ts` (register, read Mailpit, confirm) for six e2e specs
- [x] T056 T008/T009 were unreachable (`*.test.ts` matches no Vitest project; the convention is `*.unit.test.ts`) and T009 was placeholders. Renamed, rewritten as real tests, and fixed what they found: `email.ts` logged the recipient's address (Article VIII), and had no SMTP timeouts, so one stalled socket hung registration for 75 s
- [x] T057 Enumeration timing (belongs with US3, T029): on a genuine registration the request does extra work (token insert, SMTP send) that a duplicate registration does not, so the two are not yet in the same timing class (ADR 0003). Decide between not awaiting the send and padding the duplicate path, then assert it Done: ADR 0011, with the measured residual stated rather than claimed away
- [x] T058 `contracts/errors.md` says a link used twice returns `ALREADY_CONFIRMED`; spec scenario 4, FR-007 and `procedures.md` say `TOKEN_INVALID`, and the implementation (single-use, token deleted) follows the spec. `ALREADY_CONFIRMED` is therefore only reachable when an account is confirmed by other means while a token is still live. Reconcile the contract text, or drop the code Contract text reconciled with the spec; `confirmation_failed` now carries `detail.reason` as the contract says (red then green)
- [x] T059 The `e2e` job in `.github/workflows/ci.yml` started PostgreSQL only, but every e2e spec registers through the email flow and reads the mail back from Mailpit. Added a pinned Mailpit service with a health check and the `SMTP_*` and `APP_BASE_URL` env to that job. Confirmed by the first CI run: registration, confirmation, resend and scanner-safety specs passed against the Mailpit service
- [x] T060 `nodemailer@~6.9` carried eleven advisories at high or moderate severity, on the mail path of an authentication feature, and failed the CI `audit` job. Upgraded to `~10.1.7` (`@types/nodemailer@~8.0.2`; named imports, since 10.x is ESM). Real SMTP delivery re-verified end to end against Mailpit on desktop and mobile
- [x] T061 First CI run, ten e2e failures in three groups, none reproducible on the development Mac: (a) axe `target-size` on the plain text links of the auth screens (`Bereits registriert? Anmelden.` and the like): 19 px high with 23 px to the button above, one pixel short of axe's 24 px offset rule. It depends on the platform's font metrics, so it passed locally. The links now use the design system's `btn btn--ghost btn--block`, like every other link in the app, and the auth scans assert the repo's `expectTouchTargets` 44 px floor, which does not depend on fonts (observed red on four tests, then green). (b) `us3-offline` asserted `getByRole("alert")`, which also matches Next's empty, always-present route announcer: on a fast machine it passed on the announcer before the error rendered, on CI the error rendered first and strict mode threw. It now asserts the page's own `p[role="alert"]`. (c) Fixing (b) exposed that the test's closing `page.reload()` races `@serwist/next`'s default `reloadOnOnline`, and that its `not.toBeVisible()` also passes on a page that has not rendered. It now waits for the automatic reload and asserts the empty state
- [x] T062 Cleared every advisory so the CI `audit` job passes (`pnpm audit`: no known vulnerabilities). The list had grown from 14 to about 30 since it was written; it is a live feed. Direct bumps, exact-pinned: `next` 16.3.5 to 16.4.3 (also clears `sharp`, `postcss`'s `source-map-js` path and every `next` advisory), `next-intl` 4.14.9, `serwist` and `@serwist/next` 9.5.13 (clears `browserslist`), `vitest` and `@vitest/coverage-v8` 5.0.5, `trpc-to-openapi` 3.3.3, `drizzle-kit` 0.31.11, `stylelint` 17.16. Seven pnpm overrides in `pnpm-workspace.yaml` for transitive packages whose parents have not released a fix (`brace-expansion`, `esbuild`, `fast-uri`, `qs`, `source-map-js`, `vite`, `zod`), each scoped to the vulnerable range and pinned to the first patched release of the same major, with the parent chain documented beside them. `esbuild` is the one cross-minor jump (0.18 to 0.25, `drizzle-kit`'s dev-only config loader), verified by running `db:reset` against it. Verified after the upgrade: typecheck, lint, format, 176 unit, 61 isolation, 210 integration, OpenAPI unchanged, build, and 76 e2e at 2 workers and 1. Two single-worker e2e runs each failed a different 5 s UI timeout on a machine with load average 6 to 7; register measured a median of 18 ms, and a rerun was 76 of 76 in 1.8 minutes, the same as before the upgrade

---

## Summary

**Total tasks**: 62
- Setup: 7 (T001–T007)
- Token/Email infrastructure: 5 (T008–T012)
- User Story 1: 10 (T013–T022)
- User Story 2: 6 (T023–T028)
- User Story 3: 4 (T029–T032)
- User Story 4: 6 (T033–T038)
- Migration verification: 6 (T039–T044)
- Integration: 8 (T045–T052)
- Defects and follow-ups found during verification: 10 (T053–T062)

**TDD tasks**: 18 (marked "test first")
**Parallel-eligible tasks**: 31 (marked [P])

**Critical path**: T001–T007 → T008–T012 → T013–T022 → all tests green

**Human review gate**: Per ADR 0003, every auth path change requires mandatory human review before merge. Review must cover: token hashing, enumeration resistance preserved, password check ordering, audit events, no secrets in logs.
