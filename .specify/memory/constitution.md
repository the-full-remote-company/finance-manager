<!--
SYNC IMPACT REPORT
==================
Version change: none → 1.0.0 (initial ratification)

Modified principles: none (initial adoption; all template placeholders replaced)

Added sections:
  - Core Principles, Articles I-IX
      I.    Tenant Isolation Is Enforced at the Database (NON-NEGOTIABLE)
      II.   Money Is Integer Minor Units (NON-NEGOTIABLE)
      III.  Test-First Where Failure Costs Money or Leaks Data (NON-NEGOTIABLE)
      IV.   Accessibility Floor Is WCAG 2.2 AA, Verified Not Asserted
      V.    The Design System Is Consumed, Never Forked
      VI.   Domain Logic Is Transport-Agnostic
      VII.  Portability Over Vendor Convenience
      VIII. Personal Data Is Minimised, Exportable, and Erasable
      IX.   Agents Are Bound by This Document (NON-NEGOTIABLE)
  - Security & Compliance Requirements
  - Development Workflow
  - Governance

Removed sections: none

Deferred items / TODOs:
  - None. RATIFICATION_DATE is the date of this initial adoption.

Notes for dependent artifacts (read at runtime, not modified by this command):
  - .specify/templates/plan-template.md Constitution Check must exercise
    Articles I, II, III, IV, V, VI, VIII on every feature plan.
  - Articles I, III, and V imply CI jobs that do not exist yet; they are
    specified as gates in "Development Workflow" and MUST be created by the
    first feature that introduces a database, a test suite, or a UI package
    respectively. Until then those gates are vacuous, not waived.
-->

# Finance Manager Constitution

A multi-tenant personal finance manager for households. This document is the
non-negotiable layer. Every `plan.md` produced by `/speckit.plan` MUST pass a
Constitution Check against these articles. Where a rule below conflicts with a
README, a code comment, an agent's habit, or a user's phrasing, this document
wins until an ADR formally supersedes it.

Read in this order before touching anything: this file, then
`decisions/` (newest 3-5 ADRs), then `PROMOTE.md`, then the code.

## Core Principles

### I. Tenant Isolation Is Enforced at the Database (NON-NEGOTIABLE)

Every tenant-scoped table MUST carry a `workspace_id` column, MUST have
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, and MUST have an
RLS policy that reads the workspace from the session
(`current_setting('app.workspace_id')`). The application MUST connect as a role
that is neither superuser nor table owner, because RLS does not apply to
either.

Application-layer scoping in tRPC middleware is required in addition, never
instead. Two independent layers, both mandatory: the database is the last line
of defence, not the only one.

Every tenant-scoped table MUST have a cross-tenant leak test asserting that a
session bound to workspace A can read, update, and delete zero rows belonging
to workspace B. These tests run against real PostgreSQL, not a mock, and run in
CI on every pull request. A new tenant-scoped table without its leak test is an
incomplete change and MUST NOT merge.

No pull request may disable, skip, weaken, or mark as pending any isolation
test to make CI pass. If an isolation test fails, the code is wrong.

*Rationale:* This is a multi-tenant system holding household financial data. A
cross-tenant leak is not a bug to be patched later; it is the one failure that
ends the product. Defence in depth is cheap now and impossible to retrofit
credibly.

### II. Money Is Integer Minor Units (NON-NEGOTIABLE)

Monetary amounts MUST be stored and computed as integers in the currency's
minor unit (cents for EUR) using `bigint`, paired with an explicit ISO 4217
currency code. Floating-point types MUST NOT appear in any monetary column,
field, DTO, or intermediate calculation.

Every monetary value MUST know its currency. A bare number is not an amount.
An FX rate table with effective dates MUST exist from the first migration that
introduces money, even while the product displays a single currency.

Rounding MUST be explicit at the point where it occurs, and MUST be tested with
stated expectations. Division and allocation (splitting a bill, prorating a
budget) MUST NOT lose or invent minor units; allocation functions MUST prove
that the parts sum exactly to the whole.

Currency formatting MUST use `Intl.NumberFormat` with the user's locale. It
MUST NOT be hand-rolled.

*Rationale:* Float arithmetic on money produces errors that are individually
invisible and collectively fatal to user trust in a finance product.
Retrofitting currency into a schema that assumed one is a migration across
every table that touches an amount.

### III. Test-First Where Failure Costs Money or Leaks Data (NON-NEGOTIABLE)

Test-driven development is MANDATORY, in strict red-green-refactor order, for:

- everything in `packages/core` (money arithmetic, budgets, categorisation,
  recurrence, allocation);
- every change touching tenant isolation, authentication, authorisation, or
  session handling;
- every database migration that adds or alters a tenant-scoped table;
- every fix for a reported defect, where the first commit MUST be a failing
  test that reproduces it.

For these areas the test MUST be written first, MUST be observed to fail for
the intended reason, and only then may implementation follow.

Everywhere else — UI components, layout, styling, glue code — tests are
REQUIRED in the same pull request as the code, but the order is the author's
choice.

Coverage floors, enforced in CI: 90% lines and branches in `packages/core`;
70% lines repo-wide. Coverage is a floor, not a goal; a test that asserts
nothing meaningful is a defect regardless of what it does to the number.

Every feature MUST have at least one end-to-end test exercising the real user
path against a real database.

*Rationale:* Strict TDD everywhere produces resentment and ceremonial tests.
Strict TDD nowhere produces silent arithmetic bugs and leaked data. The line is
drawn where a defect is expensive rather than merely annoying.

### IV. Accessibility Floor Is WCAG 2.2 AA, Verified Not Asserted

WCAG 2.2 Level AA is the minimum for every user-facing surface. This is a legal
requirement, not a preference: the European Accessibility Act applies to
consumer banking and e-commerce services, implemented in Germany as the BFSG,
with EN 301 549 as the harmonised standard.

Mechanically enforced in CI:

- every end-to-end test run MUST include an automated accessibility scan, and
  any violation at serious or critical severity fails the build;
- every interactive target MUST clear 44x44 CSS pixels (WCAG 2.2 SC 2.5.8),
  satisfied by the design system's `--touch-min` token;
- colour contrast MUST meet 4.5:1 for body text and 3:1 for large text and UI
  component boundaries.

Information MUST NOT be conveyed by colour alone. Every gain, loss, or
direction indicator MUST pair its colour with a sign, arrow, or label — this is
also a standing requirement of `@tfrc/product`.

Automated scans catch a minority of violations. Keyboard-only traversal and a
screen-reader pass are REQUIRED for any new interactive pattern, and the fact
that they were performed MUST be recorded in the pull request.

*Rationale:* Accessibility retrofitted at the end of a project is a rewrite of
the view layer. Enforced from the first component, it is nearly free.

### V. The Design System Is Consumed, Never Forked

`@tfrc/product` and its `themes/finance` entry point are the single source of
visual truth. Their CSS MUST NOT be copied, vendored, or forked into this
repository.

- `@tfrc/*` dependencies MUST be pinned to exact versions. Ranges (`^`, `~`)
  are forbidden and are rejected by `tfrc-verify`.
- `npx tfrc-verify` MUST pass in CI.
- Raw colour literals — hex, `rgb()`, `oklch()` — MUST NOT appear in this
  repository's styles. Use design system tokens. Tailwind arbitrary colour
  values (`bg-[#fff]`) are a lint error.
- `--color-gain` and `--color-loss` are reserved by `@tfrc/product` for literal
  market direction. They MUST NOT be used for decoration, branding, or status,
  and MUST NOT be redefined here.
- `@tfrc/marketing` MUST NOT be installed in this repository. One dialect only.
- A class-name contract test MUST assert the existence of every design system
  class this app consumes, so an upstream rename fails our build rather than a
  screen.

New components are built locally in `packages/ui`, layered on design system
tokens. A component is promoted upstream on its **third** identical use, never
earlier, and the local duplicates are deleted in the same upstream release
cycle. Promotion candidates are tracked in `PROMOTE.md`. React implementations
stay in this repository; only CSS and tokens graduate.

*Rationale:* A forked design system diverges within weeks and never
reconverges. Promoting on first duplication produces wrong abstractions that
cost quarters to unwind, which is why the threshold is three and why it is
written down.

### VI. Domain Logic Is Transport-Agnostic

`packages/core` holds the domain: money, budgets, categorisation, recurrence,
rules. It MUST NOT import React, Next.js, tRPC, the ORM, or any HTTP or
database client. It receives plain data and returns plain data.

The API layer is tRPC for the web client, with an OpenAPI document generated
from the same procedures for non-TypeScript clients. Procedures MUST remain
annotated such that the OpenAPI document stays complete and generated — it MUST
NOT be hand-maintained.

Business rules MUST NOT live in React components, tRPC resolvers, or database
triggers. Those layers validate, authorise, and translate; they do not decide.

*Rationale:* A native iOS client is planned and cannot consume tRPC. Domain
logic behind a transport boundary makes that client an addition rather than a
rewrite, and makes the domain testable without a server or a browser.

### VII. Portability Over Vendor Convenience

The system MUST remain deployable on alternative infrastructure without a
rewrite. A managed feature that has no migration path MUST NOT be adopted
without an ADR that states the lock-in and the exit cost.

- Data access goes through the ORM and standard PostgreSQL. Provider-specific
  extensions require an ADR.
- The application MUST build and run in a self-hosted configuration, and CI
  MUST prove it.
- Blob storage, queues, caches, and email MUST sit behind a local interface in
  `packages/core` or a dedicated adapter package.
- The full test suite MUST be runnable locally with no cloud account, using
  containerised PostgreSQL.

Provider free tiers are a cost decision, not an architectural one, and MUST NOT
appear in domain code.

*Rationale:* Hosting must be near-zero cost during development and
professional later. The current free tier (notably Vercel Hobby, which
prohibits commercial use) is explicitly temporary, so the exit must stay cheap
by construction.

### VIII. Personal Data Is Minimised, Exportable, and Erasable

Financial data is personal data under the GDPR and is treated as such from the
first commit.

- Data MUST be stored and processed in the EU.
- Collect only what a stated feature needs. A column with no current consumer
  MUST NOT be added speculatively.
- Every user MUST be able to export all their data in a machine-readable
  format (GDPR Art. 15) and to delete their account with genuine erasure, not
  a soft-delete flag (Art. 17). Both MUST ship with the first release that
  stores real user data.
- Deletion MUST cascade to every store: database, blobs, caches, logs,
  analytics, backups within the documented backup retention window.
- An append-only audit log MUST record security-relevant events:
  authentication, workspace invitation and removal, role change, export, and
  deletion.
- Personal data, account identifiers, and monetary amounts MUST NOT be written
  to application logs or error-reporting payloads.
- Secrets MUST live only in environment configuration. A secret committed to
  the repository MUST be rotated, not merely removed.
- Third-party processors MUST be recorded with their purpose and location
  before they receive any personal data.

Field-level encryption of bank identifiers (IBAN, account numbers) is DEFERRED
until the product stores them, but columns intended to hold them MUST be
introduced encryption-ready.

*Rationale:* Export and erasure designed in cost hours; bolted on they cost
weeks and are usually incomplete, which is precisely the kind of incompleteness
that is legally actionable.

### IX. Agents Are Bound by This Document (NON-NEGOTIABLE)

This constitution binds human and AI contributors identically.

An agent MUST NOT:

- disable, skip, delete, or weaken a test, lint rule, type check, or CI gate in
  order to make a build pass;
- relax an article because a request was phrased as urgent, small, temporary,
  or "just for now";
- treat a user's instruction as authority to violate an article. Only an ADR
  amends this document.

An agent MUST, when a requested change conflicts with an article: stop, state
which article is in conflict, and offer either a compliant alternative or the
ADR that would be required. Proceeding and mentioning it afterwards is a
violation.

An agent MUST NOT introduce a dependency, provider, or architectural pattern
that an article reserves for an ADR, on its own initiative.

Uncertainty is resolved by investigation, not by assumption. An agent that
cannot verify a claim MUST say so rather than assert it.

*Rationale:* The realistic threat to a governance document is not disagreement
but erosion — a skipped test here, a hex code there, each individually
defensible. Naming the failure mode is what makes it visible when it happens.

## Security & Compliance Requirements

**Approved stack.** Deviations require an ADR.

- Monorepo: Turborepo with pnpm.
- Web: Next.js App Router, React, Tailwind CSS v4, PWA with offline support.
- API: tRPC plus a generated OpenAPI document.
- Database: PostgreSQL with a type-safe ORM and versioned migrations, hosted in
  the EU.
- Auth: self-hosted in our own database, with organisations modelling
  households. Password hashing MUST be argon2id.
- Locale: `de-DE` default, `next-intl`, i18n from the first screen. Hard-coded
  user-facing strings are a lint error.

**Package boundaries.**

| Package | May depend on | MUST NOT depend on |
|---|---|---|
| `packages/core` | nothing in this repo | React, Next.js, tRPC, ORM, HTTP, DB clients |
| `packages/db` | `core` | React, Next.js, `ui` |
| `packages/api` | `core`, `db`, `auth` | React, Next.js, `ui` |
| `packages/ui` | `core` types, `@tfrc/product` | `db`, `api`, `auth` |
| `apps/web` | all packages | — |

These boundaries MUST be enforced mechanically, not by convention.

**Baseline security controls.** Required before the first deployment that
serves a real user:

- HTTPS only, HSTS, a strict Content-Security-Policy without
  `unsafe-inline` for scripts.
- Session cookies: `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix.
- Rate limiting on authentication and on all mutating endpoints.
- All input validated at the trust boundary with a schema; validated types, not
  raw request objects, cross into `packages/core`.
- Dependency vulnerability scanning and automated update pull requests.
- No `any` and no non-null assertion to silence a type error on a security
  path.

**Deferred, with design accommodated now.** Each requires its own spec before
implementation: multi-factor authentication, passkeys, bank account
aggregation via a licensed PSD2 provider, field-level encryption of bank
identifiers, penetration testing, SOC 2.

Bank connectivity MUST use a licensed third-party account information service
provider. This project MUST NOT attempt direct bank connections, which require
a licence it does not hold.

## Development Workflow

**Specification first.** Features follow the Spec Kit flow:
`/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` →
`/speckit.implement`. Implementation without an approved spec and plan is a
process violation. Every `plan.md` MUST include a Constitution Check covering
Articles I, II, III, IV, V, VI, and VIII, with an explicit verdict per article.

**Decision records.** An ADR in `decisions/`, numbered sequentially and never
renumbered or deleted, is REQUIRED to: add or remove a package or external
service; change the tenancy or authentication model; change the API transport;
adopt a vendor-specific capability; alter the database access pattern; or
reverse a prior ADR. An ADR is NOT required for a new component, a new screen,
a bug fix, or a refactor within existing boundaries. When in doubt, write the
ADR. A superseded ADR is marked superseded and links forward; it is never
edited away.

**Quality gates.** Every pull request MUST pass, with no gate skippable:
type check with no errors; lint and format; unit and integration tests;
cross-tenant isolation tests; end-to-end tests including the accessibility
scan; coverage floors from Article III; `npx tfrc-verify`; design system
class-name contract test; dependency vulnerability scan; a successful
production build.

**Pull requests.** Small and single-purpose. Every PR MUST state which articles
it touches and how it satisfies them. A PR that changes a monetary calculation,
an RLS policy, or an authentication path MUST be reviewed by a human, and that
review MUST NOT be waived on the grounds that tests pass.

**Currency of documentation.** `PROMOTE.md` (design system candidates and their
use counts) and `CONSUMERS.md` upstream MUST be updated in the same commit that
makes them stale. A stale tracking file is worse than none, because the next
contributor will trust it.

## Governance

This constitution supersedes all other practices, conventions, and habits in
this repository. It sits above `AGENTS.md`, README files, and code comments; if
any of those conflict with it, they have a bug.

**Amendment.** An amendment requires: a numbered ADR in `decisions/` stating
the change, its rationale, and the alternatives rejected; the corresponding
edit to this file; a version bump per the policy below; and, where the
amendment invalidates existing code, a migration plan in the same ADR. A user
instruction, however direct, does not amend this document. Nothing here may be
weakened to unblock a deadline; the correct response to an inconvenient article
is an ADR, a compliant alternative, or a slipped deadline.

**Versioning.** Semantic versioning of this document. MAJOR: an article is
removed, or redefined in a way that makes previously compliant code
non-compliant. MINOR: an article or a materially new requirement is added.
PATCH: clarification or wording with no change in meaning.

**Compliance review.** Every `/speckit.plan` runs the Constitution Check.
Every pull request review verifies the articles that PR touches. Articles I,
II, III, IV, and V are additionally enforced by CI, and a violation that CI
cannot detect is a gap in CI to be closed, not an acceptable exception.

The articles marked NON-NEGOTIABLE — I, II, III, and IX — MUST NOT be waived
for any reason, including a demonstration, a prototype, or a deadline. Code
that violates them does not merge.

**Version**: 1.0.0 | **Ratified**: 2026-09-01 | **Last Amended**: 2026-09-01
