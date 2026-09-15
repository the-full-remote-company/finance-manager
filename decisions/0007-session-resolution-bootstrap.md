# 7. Session resolution bootstraps tenancy through a SECURITY DEFINER function

Date: 2026-09-16

## Status

Accepted.

## Context

Article I requires every tenant-scoped table to carry `workspace_id`, to have
`ENABLE` and `FORCE ROW LEVEL SECURITY`, and to have a policy reading
`current_setting('app.workspace_id')`. The application connects as `app`, a
role that is neither superuser nor table owner, so those policies always apply
to it.

`sessions` is tenant-scoped and carries such a policy. That produces a
bootstrap problem discovered while wiring `protectedProcedure`:

- a request arrives carrying only an opaque session token;
- to know the workspace, the server must read the `sessions` row;
- to read the `sessions` row, `app.workspace_id` must already be set;
- to set it, the server must already know the workspace.

Verified against the running database rather than reasoned about: as `app`
with no workspace set, `select count(*) from sessions` returns 0 while the
owner sees 2. The policy is working exactly as designed, and authentication
can never get off the ground.

## Decision

A single `SECURITY DEFINER` function, owned by the migration owner, resolves a
session token hash to its identifiers:

```sql
CREATE FUNCTION app_resolve_session(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, workspace_id uuid,
               expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT id, user_id, workspace_id, expires_at, revoked_at
  FROM public.sessions
  WHERE token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_session(text) TO app;
```

`protectedProcedure` calls it, then opens the transaction that runs
`SET LOCAL app.workspace_id` and executes the resolver inside it. Everything
after the bootstrap is subject to RLS exactly as before.

The function is deliberately narrow:

- it takes a **hash**, not a token, and not a user-controlled predicate;
- it returns five non-secret fields and no others — no `token_hash`, no
  password hash, nothing from `users`;
- it returns at most one row, because `token_hash` is unique;
- `search_path` is pinned, so a `SECURITY DEFINER` function cannot be
  hijacked by a caller-controlled schema — the standard failure mode for this
  feature in PostgreSQL;
- `EXECUTE` is revoked from `PUBLIC` and granted only to `app`.

## Consequences

**What this costs.** There is now exactly one path by which the application
role reads a tenant-scoped table without a workspace in scope. It is a real
hole in the "two independent layers" argument, and it must stay the only one.
A test asserts that `app_resolve_session` is the sole `SECURITY DEFINER`
function in the schema, so a second one cannot appear unnoticed.

**Why the alternatives are worse:**

- *Make `sessions` non-tenant-scoped*, like `auth_attempts`. Defensible on the
  same reasoning — it is consulted before a workspace is known — and it was
  the near-miss. Rejected because a session row carries `workspace_id` and
  `user_id` and is worth protecting for its own sake: with no policy, any SQL
  injection reaching `sessions` yields every live session in the system rather
  than one workspace's. The bootstrap needs one narrow read, not a permanently
  open table.
- *Grant `BYPASSRLS` to `app`*. Rejected outright: it disables tenancy
  everywhere to solve a problem in one query, and Article I explicitly
  requires the application role to be RLS-bound.
- *A second database role with its own connection, holding only
  `SELECT (workspace_id, user_id) ON sessions`*. Equivalent security, but it
  adds a second pool, a second credential to rotate, and a second URL to
  configure wrongly. The function achieves the same narrowing without any of
  that.
- *Encode the workspace in the session cookie.* Rejected: the client would
  then assert its own tenancy, and a forged or replayed cookie would pick the
  workspace. Tenancy must be derived server-side from stored state.

**Article I is satisfied, not waived.** Every tenant-scoped table keeps
`ENABLE`, `FORCE` and its policy; the application role remains non-owner,
non-superuser and `NOBYPASSRLS`; the leak tests are unchanged and still pass.
What changes is that one auditable, argument-constrained function is permitted
to answer a single question — "which workspace does this token hash belong
to?" — that cannot be answered any other way.
