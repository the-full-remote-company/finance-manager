# ADR 0004 — Vitest, Playwright and axe as the verification stack

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: Article III (test-first, coverage floors), Article IV
(accessibility verified not asserted), Article VII (runnable with no cloud
account); required by "Decision records" — adds packages.

## Context

This is the first feature to introduce a test suite, so it owes the CI gates the
constitution's sync-impact note describes as "vacuous, not waived".

Article III requires strict red-green-refactor TDD in `packages/core` and on
every isolation, auth and migration change; coverage floors of 90% lines and
branches in `packages/core` and 70% lines repo-wide, enforced in CI;
cross-tenant leak tests against real PostgreSQL rather than a mock; and at least
one end-to-end test per feature against a real database.

Article IV requires an automated accessibility scan inside every end-to-end run,
failing the build on any serious or critical violation, plus recorded
keyboard-only and screen-reader passes for new interactive patterns.

## Decision

- **Unit and integration**: Vitest, one project per workspace package, with V8
  coverage and per-package thresholds configured so `packages/core` fails below
  90% lines and branches and the repository fails below 70% lines.
- **Property tests**: `fast-check` for the allocation and share-rounding
  invariants, which SC-002 requires over at least one thousand generated
  combinations.
- **Database integration and isolation**: Vitest against the container
  PostgreSQL from ADR 0002, each test file in its own transaction rolled back
  afterwards, with a shared helper that opens a session bound to a given
  workspace. No mocking of the database anywhere.
- **End-to-end**: Playwright against a built application and the container
  database.
- **Accessibility**: `@axe-core/playwright`, asserted in every end-to-end spec
  that renders a screen. The run fails on any violation of serious or critical
  impact. Touch-target size and contrast are additionally asserted against the
  `@tfrc/product` tokens rather than measured by axe alone.
- **Manual accessibility passes**: keyboard-only traversal and a screen-reader
  pass are recorded in the pull request body for every new interactive pattern,
  per Article IV. This is a checklist item, not a tool.

## Consequences

- One runner for everything below the browser and one for the browser, which
  keeps the CI matrix small.
- Article III's "real PostgreSQL, not a mock" is structural: there is no mock to
  reach for.
- Coverage thresholds live in configuration and cannot be lowered in a pull
  request without that change being visible in the diff. Article IX forbids
  lowering them to pass a build.
- Playwright's browser download adds time to a cold CI run. Accepted, and cached.

## Alternatives rejected

- **Jest** — slower on a Turborepo/ESM/Tailwind v4 toolchain and requires more
  transform configuration for the same result.
- **Cypress** — no maintained first-party axe integration equivalent to
  `@axe-core/playwright`, and weaker handling of multiple origins.
- **Mocked database for isolation tests** — forbidden by Article I, which
  requires the leak tests to run against real PostgreSQL. Listed only to record
  that it was considered and is not available.
