# ADR 0001 — Drizzle ORM as the database access layer

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: Article I (tenant isolation), Article VII (portability);
required by "Decision records" — adds a package and fixes the database access
pattern.

## Context

Article I requires every tenant-scoped table to carry `workspace_id`, to have
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, and to have a policy
reading `current_setting('app.workspace_id')`. The application must connect as a
role that is neither superuser nor table owner. Article VII requires data access
to go through an ORM and standard PostgreSQL, with no provider-specific
extension adopted without an ADR.

This is the first feature to introduce a database, so the ORM is chosen now and
the whole schema is built on it.

Two properties matter more than developer ergonomics:

1. The session variable must be set per transaction, not per connection.
   Connection pooling means a value set outside a transaction can be observed by
   an unrelated later request. `SET LOCAL app.workspace_id` inside the
   transaction is the only safe form, so the ORM must expose the transaction
   handle directly.
2. RLS policies and `FORCE ROW LEVEL SECURITY` must live in reviewed,
   hand-authored SQL. They are the last line of defence and a human reviews every
   change to them.

## Decision

Use `drizzle-orm` with `drizzle-kit` for schema definition and versioned
migrations, against standard PostgreSQL over the `pg` driver.

- Schema is declared in TypeScript in `packages/db/src/schema/`.
- Migrations are the SQL files emitted by `drizzle-kit generate`, committed, and
  hand-extended with the RLS statements for every tenant-scoped table.
- Every request opens one transaction, issues
  `SET LOCAL app.workspace_id = $1`, and performs all work inside it. A single
  `withWorkspace(workspaceId, fn)` helper is the only sanctioned entry point;
  using the raw client outside it is a lint error.
- The application connects as role `app`, which owns nothing and is not a
  superuser. Migrations run as a separate owner role.

## Consequences

- Policies are visible in the diff of every migration, which is what makes
  Article I reviewable rather than asserted.
- No provider-specific client sits in the data path, keeping Article VII's exit
  cost at zero.
- Drizzle's relational query builder is less capable than Prisma's for deep
  nested reads. Accepted: this feature's heaviest read is one flat load of a
  workspace's commitments, amounts and overrides.
- `drizzle-kit` occasionally requires manual editing of a generated migration
  when a rename is inferred as a drop-and-create. Migrations are reviewed by a
  human regardless, per "Pull requests".

## Alternatives rejected

- **Prisma** — the session variable and `FORCE ROW LEVEL SECURITY` both require
  `$executeRaw`/`$queryRaw` escape hatches, and generated migration SQL makes
  policy authorship a fight against the tool rather than a use of it.
- **Kysely with hand-written migrations** — equal control over SQL, but no
  single schema source from which types derive, so the DTO surface crossing into
  `packages/core` would be maintained by hand.
