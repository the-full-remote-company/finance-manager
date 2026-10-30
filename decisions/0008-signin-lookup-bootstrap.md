# 8. Sign-in lookup extends the SECURITY DEFINER bootstrap to a second function

Date: 2026-09-16

## Status

Accepted.

## Context

ADR 0007 resolved a bootstrap problem for session tokens: the application role
cannot read a tenant-scoped table under RLS before `app.workspace_id` is set,
and setting it requires already knowing the workspace. It fixed this with one
narrow `SECURITY DEFINER` function, `app_resolve_session`, and a test asserting
it is the *only* such function in the schema.

`auth.signIn` (US1, T064) hits the identical circularity one step earlier: a
request carries only an email and a password, not a workspace or a session
token. To verify the password the server must read the matching `users` row's
`password_hash`; to read it under RLS, the workspace must already be known;
the workspace is exactly what this row would tell it.

Verified against the running database, the same way ADR 0007 was: as `app`
with no workspace set, `select * from users where lower(email) = $1` returns
zero rows regardless of whether a matching user exists in some other
workspace. The policy is working as designed, and sign-in cannot get off the
ground either.

## Decision

A second narrow `SECURITY DEFINER` function, on the same terms as
`app_resolve_session`:

```sql
CREATE FUNCTION app_authenticate(p_email text)
RETURNS TABLE (user_id uuid, workspace_id uuid, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT id, workspace_id, password_hash
  FROM public.users
  WHERE lower(email) = p_email
$$;

REVOKE ALL ON FUNCTION app_authenticate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_authenticate(text) TO app;
```

`auth.signIn` calls it with the already-lowercased input email, verifies the
returned `password_hash` with argon2id, then opens the `withWorkspace`
transaction for everything after — issuing the session, writing the audit
event — exactly as `protectedProcedure` does after `app_resolve_session`.

The function is narrow on the same four terms ADR 0007 used:

- it takes an **email**, not a user-controlled predicate, and the caller has
  already lower-cased it, so the function's own comparison is a plain
  equality against a unique index;
- it returns exactly the three fields sign-in needs and nothing else from
  `users` — no email column back, no display name;
- it returns at most one row, because `users_email_lower_key` is a unique
  index on `lower(email)`;
- `search_path` is pinned and `EXECUTE` is revoked from `PUBLIC`, granted only
  to `app`, identically to `app_resolve_session`.

`auth.register` does **not** need a third function. It only ever *writes* a
new workspace and a new user, and it generates both identifiers itself before
the insert, so it can call `withWorkspace` with the id it is about to create —
the workspace does not need to be "already known" by reading anything. A
colliding email is caught by `users_email_lower_key`'s own unique-violation
error, which Postgres raises regardless of row visibility: the constraint is
enforced at the index, not filtered by the policy that would otherwise hide
the conflicting row. No read of another workspace's data occurs at any point.

The policy-coverage test (`packages/db/tests/isolation/policy-coverage.test.ts`)
is updated from "exactly one" to "exactly these two, `app_authenticate` and
`app_resolve_session`" — asserted as an exact, sorted list, for the same
reason ADR 0007 asserted a singleton: a third function must fail this test
rather than appear unnoticed.

## Consequences

**What this costs.** Two narrow, unauditable-by-RLS reads instead of one.
Both are justified by the same argument ADR 0007 already accepted, applied to
one step earlier in the same flow, and the test that used to say "exactly one"
now says "exactly these two, by name" — the invariant is preserved, only its
cardinality changes, deliberately and reviewably.

**Why not fold the two into one function?** `app_resolve_session` is keyed by
a session token hash and returns lifetimes; `app_authenticate` is keyed by an
email and returns a password hash. A single function taking "a token hash or
an email" would need a caller-supplied discriminant, which is exactly the kind
of caller-controlled branching inside a `SECURITY DEFINER` body ADR 0007's
"narrow, not general" argument exists to avoid. Two single-purpose functions
each stay auditable in isolation; one dual-purpose function would not.

**Why not read `password_hash` some other way?** The alternatives ADR 0007
already rejected for session resolution — `BYPASSRLS`, a second role and pool,
encoding tenancy in a client-supplied value — fail here for the identical
reasons stated there, applied to a password hash instead of a session row.

**Article I is satisfied, not waived**, for the same reason ADR 0007 states:
every tenant-scoped table keeps `ENABLE`, `FORCE` and its policy; `app` stays
non-owner, non-superuser, `NOBYPASSRLS`; the leak tests are unchanged and still
pass. Two auditable, argument-constrained functions are now permitted to
answer two single questions neither RLS nor any other stored state can answer
before a workspace is known.
