# Implementation Plan: Email Verification for Registration

**Branch**: `002-email-verification` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-email-verification/spec.md`

## Summary

New accounts stay pending until the user clicks a confirmation link sent via SMTP.
No session is created at registration; instead, an unconfirmed account and workspace
are created and a confirmation email is sent. Clicking the link confirms the account
and creates a session, landing the user on `/dashboard`. Unconfirmed accounts can
request a resend. The feature preserves ADR 0003's enumeration resistance: a duplicate
registration looks identical to a genuine one. Accounts created before this feature
ships are grandfathered as confirmed by the migration. Sign-in to an unconfirmed
account with the correct password returns a "not confirmed" message and offers resend;
a wrong password returns the generic failure as before.

Technical approach: add `confirmed` and `confirmed_at` to `users` (defaulting
confirmed for existing rows), create a tenant-scoped `confirmation_tokens` table with
hashed tokens (following the session-token pattern in ADR 0003), send email via
`nodemailer` over SMTP configured by environment variables. Rate-limit resend via the
existing `auth_attempts` mechanism. A new `/confirm` page accepts the token, confirms
the account on an explicit button press (not on page load), and creates a session.
The success screen after registration is rewritten to explain the flow and offer
resend. This touches the authentication path, so every change is built test-first
and requires mandatory human review per ADR 0003.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 LTS

**Primary Dependencies**: `nodemailer` 10.1 (SMTP client; 6.9 in the first draft, replaced because of advisories, see tasks T060), `@node-rs/argon2` 2.2
(password hashing, already present from feature 001). Email templates are plain text
in German (de-DE). No template engine is introduced.

**Storage**: PostgreSQL 17. New `confirmation_tokens` table: tenant-scoped, carries
`workspace_id`, stores SHA-256 hash of token (not plaintext), has `expires_at` and
`superseded_at` timestamps. Migration adds `confirmed boolean NOT NULL DEFAULT true`
and `confirmed_at timestamptz` to `users`, defaulting existing rows to confirmed with
the migration timestamp.

**Testing**: Vitest for unit and integration tests of token issue/verify/invalidate
and email send stubbing. Playwright end-to-end tests for the registration flow,
confirmation flow, resend flow, and unconfirmed sign-in. A contract test asserts
duplicate registration timing falls in the same class as genuine registration.

**Target Platform**: Self-hosted Next.js PWA (unchanged from feature 001).

**Project Type**: Turborepo/pnpm monorepo (unchanged).

**Performance Goals**: Registration and confirmation are one-time actions. No change
to existing SC-006 or SC-011. Email send is async and logged on failure but does not
block the registration response.

**Constraints**: SMTP provider is user-configured via environment variables, not
hard-coded (FR-016). Local development uses a mail catcher (Mailpit or MailHog,
specified in quickstart.md). Send failures are logged but never shown to the caller
(FR-017). Confirmation tokens never appear in logs, audit events or error responses
(FR-018).

**Scale/Scope**: 3 new functional requirements (FR-001 to FR-020), 4 user stories,
1 new tenant-scoped table, changes to `packages/auth`, `packages/api/src/routers/auth.ts`,
and the registration/sign-in screens in `apps/web`. Fixes two bugs in the
pre-feature registration screen: it called `router.prefetch` instead of navigating
(spec FR-013), and its copy promised an email that nothing sent (spec FR-014).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution v1.0.0. An explicit verdict per article.

| Article | Verdict | How this plan satisfies it |
|---|---|---|
| I. Tenant isolation at the database | **PASS** | `confirmation_tokens` is tenant-scoped: carries `workspace_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, RLS policy on `current_setting('app.workspace_id')`. Foreign key to `users` is composite, carrying `workspace_id`. A cross-tenant leak test is written for this table (added to `packages/db/tests/isolation/`). Migration alters `users` with new columns but does not change its tenant scoping. |
| II. Money is integer minor units | **N/A** | This feature touches no monetary columns or arithmetic. |
| III. Test-first where failure costs money or leaks data | **PASS** | This touches the authentication path. Every change is test-first per ADR 0003. Token issue, verify, invalidate, and resend are pure functions in `packages/auth` built red-green-refactor. Migration has an integration test asserting existing rows are confirmed. Confirmation and resend procedures have contract tests. Duplicate registration timing is a property test. At least one e2e test per user story. |
| IV. WCAG 2.2 AA, verified | **PASS** | New screens (/confirm, rewritten registration success) run through axe in the e2e suite. No colour-only information. Resend button is a real button, meets touch target minimum. |
| V. Design system consumed, never forked | **PASS** | No new components. Success and confirmation screens use existing `@tfrc/product` tokens and `packages/ui` components. No raw colours. |
| VI. Domain logic transport-agnostic | **PASS** | Token generation, hashing, expiry check, and invalidation are pure functions in `packages/auth`, no tRPC/Next.js/React imports. Email send is a separate interface so local development can stub it and a future feature can swap SMTP for an API-based provider without touching auth logic. |
| VII. Portability over vendor convenience | **PASS** | SMTP via `nodemailer`, configured by environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). No provider is hard-coded. Local development uses Mailpit (Docker container). The interface allows swapping SMTP for AWS SES SDK or Postmark SDK in a future ADR without changing auth or the API layer. |
| VIII. Personal data minimised, exportable, erasable | **PASS** | Confirmation tokens are hashed at rest (only SHA-256 digest stored). Audit events record confirmation and resend (both successes and failures) with `workspace_id` and `user_id`, nulled on account deletion as before. No email content is logged. `dataRights.export` returns `confirmed` and `confirmed_at` alongside existing user fields. `dataRights.deleteAccount` cascades to `confirmation_tokens` via foreign key. No third-party processor receives email content (SMTP is direct, no tracking pixels). |
| IX. Agents are bound by this document | **PASS** | This plan was written under constitution v1.0.0 and passes the check. |

**Additional gates owed**: Cross-tenant leak test for `confirmation_tokens`. This is
a new tenant-scoped table and must have its own leak test before merging.

**Deviations requiring justification**: none. The Complexity Tracking table below is
empty.

**ADRs written for this feature**: None. This feature builds on ADR 0003 (hand-rolled
sessions) and uses the same token-hashing and rate-limiting patterns. Email send is
abstracted behind an interface per Article VII, but the choice of `nodemailer` over a
vendor SDK does not require an ADR (it is the vendor-agnostic choice). If a future
feature switches to a specific provider's SDK, that switch will need an ADR.

## Project Structure

### Documentation (this feature)

```text
specs/002-email-verification/
├── plan.md              # This file
├── spec.md              # Feature specification (with clarifications)
├── data-model.md        # Phase 1 output — confirmation_tokens table, users migration
├── contracts/           # Phase 1 output — auth.register/confirm/resendConfirmation
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

Changes to existing structure from feature 001. No new packages or apps.

```text
apps/web/
├── app/(auth)/register/page.tsx       # MODIFIED: success screen with resend
├── app/(auth)/confirm/page.tsx        # NEW: token confirmation page
├── app/(auth)/sign-in/page.tsx        # MODIFIED: unconfirmed account handling
└── messages/de.json                   # MODIFIED: new strings for confirm flow

packages/auth/
├── src/index.ts                       # MODIFIED: export confirm token functions
├── src/confirm-token.ts               # NEW: issue/verify/invalidate
└── tests/confirm-token.test.ts        # NEW: unit tests for token functions

packages/api/src/routers/
├── auth.ts                            # MODIFIED: register, signIn, new confirm/resend
└── auth.confirm.test.ts               # NEW: integration tests for confirm procedures

packages/db/
├── src/schema/confirmation-tokens.ts  # NEW: table schema
├── migrations/00XX-add-confirmation.sql  # NEW: table + users columns + migration data
└── tests/isolation/confirmation-tokens.test.ts  # NEW: cross-tenant leak test

scripts/
└── send-test-email.ts                 # NEW: dev tool to verify SMTP config

docker-compose.yml                     # MODIFIED: add Mailpit service for local dev
```

**Structure Decision**: All changes are in existing packages. `packages/auth` gains
confirmation token functions alongside session token functions. `confirmation_tokens`
is a new table in `packages/db/src/schema/`. The email send interface is abstracted
in `packages/auth` so SMTP can be swapped for an SDK later without touching
`packages/api`. No new dependencies on the web app or API — email is sent server-side
in the tRPC resolver.

## Open questions and owed verifications

| Item | Question | Default taken | Resolution path |
|---|---|---|---|
| OQ-1 | SMTP provider for production | Recommend a reputable transactional provider, Postmark or AWS SES, over a self-hosted MTA: deliverability and reputation risk is the wrong trade for security-relevant mail on a finance app. Transport is `nodemailer` over SMTP, so the provider stays swappable. Local dev uses Mailpit. Config via env vars is provider-agnostic. | User chooses provider and supplies credentials. Quickstart.md documents both Postmark and AWS SES config examples. |
| OQ-2 | Confirmation link validity window | 24 hours (FR-003). | User confirmation. If changed, update FR-003 and the constant in `packages/auth/src/confirm-token.ts`. |
| OQ-3 | Resend throttling threshold | Reuse `AUTH_RATE_LIMIT` (5 attempts per 15 minutes per identifier+IP, from ADR 0003). | User confirmation. If separate threshold needed, add `CONFIRMATION_RATE_LIMIT` and use it in `auth.resendConfirmation`. |

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.
