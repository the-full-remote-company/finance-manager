# Phase 1 Quickstart: Recurring Budget Planner

**Feature**: `001-recurring-budget-planner` | **Date**: 2026-09-15

**Input**: [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

This describes the repository as it will exist once this feature is implemented.
Nothing below exists yet — the repository currently holds specifications and
ADRs only. It is written now because it is the acceptance statement for the
scaffolding tasks: when every command here runs clean on a fresh clone, the
setup phase is done. Article VII requires the whole suite to run locally with no
cloud account, so every command below works offline apart from the initial
install.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 LTS | Next.js 16 baseline |
| pnpm | 10 | Mandated monorepo package manager |
| Docker | any current | Containerised PostgreSQL 17, per [ADR 0002](../../decisions/0002-postgres-local-container.md) |

No cloud account, no managed database, no `@tfrc` registry token beyond the
public npm registry.

---

## First run

```bash
pnpm install                  # exact versions; @tfrc/* are pinned, per Article V
cp .env.example .env.local    # no secret in the file; placeholders only
docker compose up -d db       # PostgreSQL 17 on 5432
pnpm db:migrate               # drizzle-kit, plain SQL migrations
pnpm db:seed:dev              # two workspaces with overlapping data, for leak tests
pnpm dev                      # http://localhost:3000, de-DE
```

`docker compose up -d db` starts a single service. The database it creates has
two roles: the migration owner, and `app`, which owns no table and is not a
superuser. The application connects only as `app`, because RLS does not apply to
an owner, per Article I.

### Environment

`.env.example` is committed with placeholders; `.env.local` is gitignored. A
secret committed to the repository must be rotated, not merely removed, per
Article VIII.

```text
DATABASE_URL_OWNER=postgres://owner:owner@localhost:5432/finance   # migrations only
DATABASE_URL=postgres://app:app@localhost:5432/finance             # runtime, non-owner
SESSION_COOKIE_NAME=__Host-session
```

There is no API key of any kind. The feature integrates with no third-party
processor, which is why none is recorded under Article VIII.

---

## Verifying a change

Every command here is a CI gate from "Quality gates". None is skippable, and no
agent may weaken one to get a green build, per Article IX.

```bash
pnpm typecheck              # no errors; no `any` on a security path
pnpm lint                   # boundaries, raw colour literals, hard-coded strings, openapi meta
pnpm test:unit              # vitest; packages/core, 90% lines and branches
pnpm test:integration       # vitest against container PostgreSQL
pnpm test:isolation         # cross-tenant leak tests, per table, real PostgreSQL
pnpm test:e2e               # playwright, includes the axe scan
pnpm verify:design-system   # npx tfrc-verify + the class-name contract test
pnpm openapi:check          # regenerates the document and diffs it
pnpm build                  # production build
```

`pnpm verify` runs all of them in the order above — cheapest signal first.

### What each gate exists to catch

| Gate | Fails when | Article |
|---|---|---|
| `test:isolation` | A session bound to workspace A reads, updates, or deletes a single row of workspace B | I |
| `test:unit` | `allocate` loses a cent, `applyShare` rounds by float, coverage drops below the floor | II, III |
| `test:e2e` | An axe violation at serious or critical severity, or the user path breaks | III, IV |
| `verify:design-system` | A `@tfrc/*` range appears in a manifest, or an upstream class this app consumes is renamed | V |
| `lint` | `packages/core` imports tRPC or the ORM; a hex colour; a user-facing literal; a procedure missing `.meta({ openapi })` | V, VI |
| `openapi:check` | The committed document no longer matches the router | VI |
| `build` | The self-hosted configuration does not build against the container database | VII |

---

## Working on the domain

`packages/core` is pure. It imports nothing from this repository and nothing that
touches React, Next.js, tRPC, the ORM, HTTP, or a database client, per Article
VI. It is therefore the fastest thing in the repository to test, and strict
red-green-refactor is mandatory there, per Article III.

```bash
pnpm --filter @finance/core test --watch
```

The order is not optional: write the failing test, observe it fail for the
intended reason, then implement. The money and projection functions
([research.md](./research.md) Part B) are exactly the code where a silent
arithmetic defect is expensive, which is where the constitution draws the line.

Property tests run over at least one thousand generated combinations for
`allocate`, per SC-002:

```text
sum(allocate(total, parts)) === total
max(allocate(total, parts)) - min(allocate(total, parts)) <= 1
```

---

## Two verifications owed before implementation

Both are tasks, not assumptions. Article IX forbids asserting either without
executing it.

**VQ-1 — generated month columns.** Confirm PostgreSQL 17 accepts
`EXTRACT(... FROM <date column>)` inside a `GENERATED ALWAYS AS ... STORED`
expression. If it rejects it as non-immutable, fall back to a plain
`integer not null` column with a `CHECK` constraint, derived in `packages/core`.
The schema shape and every constraint are unchanged either way, per
[data-model.md](./data-model.md).

```bash
docker compose up -d db && pnpm db:verify:generated-columns
```

**VQ-2 — queries must be HTTP GET.** Confirm the tRPC client issues queries as
`GET`, and pin it explicitly rather than inheriting the default, per
[contracts/README.md](./contracts/README.md). A query that silently degrades to
`POST` is uncacheable by the service worker and would break FR-035b. The check
asserts the method for the largest real query input in this feature.

```bash
pnpm test:e2e -- --grep "queries are issued as GET"
```

---

## Exercising offline behaviour

The service worker is a read-through cache with no write path, per
[ADR 0006](../../decisions/0006-offline-read-only-cache.md).

```bash
pnpm build && pnpm start                    # the service worker is not active in dev
pnpm test:e2e -- --grep "offline"
```

What the offline tests assert, matching FR-035a–FR-035e:

1. The app launches with the network disabled.
2. A previously viewed month renders, marked with the time it was retrieved.
3. A month never visited says "not available offline" — distinct from "no data".
4. A save attempt fails immediately with `OFFLINE_READ_ONLY`, and nothing is
   queued.
5. Sign-out destroys every cache and the persisted client store.

`health.ping` is never cached. A cached success would report a live server to an
offline client.

---

## Resetting

```bash
pnpm db:reset            # drops, recreates, migrates, reseeds
docker compose down -v   # removes the volume as well
```

Deletion in this system is genuine, per Article VIII. `dataRights.deleteAccount`
removes the workspace row and cascades; after it, every previously valid
identifier returns `NOT_FOUND`. The end-to-end test asserts that by reusing the
identifiers it captured before the deletion, which is SC-009.
