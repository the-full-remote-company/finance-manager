# ADR 0002 — PostgreSQL runs in a local container; managed hosting is deferred

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: Article VII (portability), Article VIII (EU data residency);
required by "Decision records" — an external service would be added.

## Context

Article VII requires that the full test suite run locally with no cloud account
against containerised PostgreSQL, and that CI prove the application builds and
runs self-hosted. Article VIII requires data to be stored and processed in the
EU. Article VII also requires an ADR stating lock-in and exit cost before any
managed feature with no migration path is adopted.

This feature needs a database to be built and verified. It does not need a
deployment, and there is no real user data yet.

## Decision

Development and CI use PostgreSQL 17 in a container, declared in
`docker-compose.yml` at the repository root and started by
`pnpm db:up`. Connection is by `DATABASE_URL` only; nothing in the codebase
knows where the database is.

The choice of managed host is deferred to a future ADR, to be written when a
deployment serving a real user is planned. That ADR must state the region (EU,
per Article VIII), the lock-in, and the exit cost.

Constraints binding on this feature so the deferral stays cheap:

- Only standard PostgreSQL features. Any extension beyond `pgcrypto` requires
  its own ADR.
- Access over the standard `pg` TCP driver. No provider-specific serverless
  driver in `packages/db`.
- No provider-managed auth, storage, queue or cron. Article VIII's audit log and
  Article VII's adapter rule already force these behind local interfaces.

## Consequences

- Zero hosting cost and zero vendor surface during development.
- Article VII's "runnable locally with no cloud account" and "CI proves
  self-hosted" gates are satisfied by construction rather than by a later
  retrofit.
- A developer must have Docker available. Accepted; it is already required by
  Article VII's test rule.
- The first deployment is blocked on writing the hosting ADR. Deliberate: that
  is the point at which the trade-off is real and the region is a legal
  question.

## Alternatives rejected

- **Neon (EU region)** — generous free tier and a compliant region, but its
  serverless HTTP/WebSocket driver differs from plain `pg`, putting a
  provider-specific client in the data path before any need exists.
- **Supabase (EU region)** — plain PostgreSQL with strong RLS tooling, but it
  bundles auth and storage that the constitution requires us to self-host
  anyway, so most of the platform is unusable weight.
