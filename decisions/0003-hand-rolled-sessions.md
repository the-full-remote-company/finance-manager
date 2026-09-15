# ADR 0003 — Hand-rolled argon2id session authentication

**Status**: Accepted

**Date**: 2026-09-15

**Feature**: `001-recurring-budget-planner`

**Constitution**: Article I (isolation), Article III (test-first on auth),
Article VIII (erasure, audit log), "Approved stack" (self-hosted auth, argon2id),
"Baseline security controls"; required by "Decision records" — fixes the
authentication model.

## Context

The constitution already requires self-hosted authentication in our own database
with argon2id password hashing, organisations modelling households, `__Host-`
prefixed `httpOnly` `Secure` `SameSite=Lax` session cookies, and rate limiting on
authentication. It defers multi-factor authentication and passkeys to their own
specs.

What remains open is whether to build on an auth library or own the code.

Article I requires every tenant-scoped table to carry `workspace_id` and to have
a cross-tenant leak test. Article VIII requires genuine erasure cascading to
every store and an append-only audit log of authentication, export and deletion.
A library that owns its own schema puts its tables outside both requirements.

The surface this release needs is small: register (which also creates the
workspace, FR-001), sign in, sign out, verify a session, throttle failed
attempts (FR-005), and delete everything (FR-041).

## Decision

Own the implementation, in `packages/auth`.

- **Passwords**: argon2id via `@node-rs/argon2`, parameters
  `memoryCost = 19456` KiB, `timeCost = 2`, `parallelism = 1` — the OWASP
  Password Storage Cheat Sheet's second listed configuration. Parameters are a
  single exported constant; changing them is a change to this ADR.
- **Sessions**: 128 bits from `crypto.randomBytes(16)`, base64url encoded. Only
  the SHA-256 hash of the token is stored, so a database read cannot impersonate
  a user. Absolute expiry 30 days; sliding renewal when more than 24 hours old.
- **Cookie**: `__Host-session`, `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
  The `__Host-` prefix forbids a `Domain` attribute and requires `Secure`, which
  makes local development use HTTPS or an exempted `localhost` origin.
- **Throttling**: a non-tenant-scoped `auth_attempts` table keyed by a hash of
  the identifier and of the client IP, with a fixed-window counter. Exceeding
  the threshold returns the same generic failure as a wrong password, so the
  response does not distinguish throttled from incorrect.
- **Audit**: every sign-in success, sign-in failure, sign-out, export and
  account deletion appends to `audit_events`. The table grants no `UPDATE` or
  `DELETE` to the application role.
- **Enumeration**: registration and sign-in return responses that do not reveal
  whether an address is registered.
- **Erasure**: account deletion is a single transaction deleting the workspace
  row, cascading by foreign key to every tenant-scoped table, plus a client-side
  purge of all caches (see ADR 0006). No soft-delete column exists anywhere.

Per Article III, every one of the above is built test-first.

## Consequences

- `users` and `sessions` are ordinary tables under our own RLS policies with
  their own leak tests, satisfying Article I without exception.
- Erasure is a foreign-key cascade we control, which is what makes Article
  VIII's "genuine erasure" verifiable rather than hopeful.
- Passkeys and MFA, when specified, are added by us rather than enabled by a
  flag. Accepted: the constitution defers both, and each requires its own spec.
- Session revocation, device listing and email verification are code we write
  when specified. None is required by this feature.
- We carry the maintenance risk of a security-critical component. Mitigated by
  the mandatory human review of every authentication-path change and by
  Article III's test-first requirement.

## Alternatives rejected

- **better-auth** — self-hosted and would supply passkeys and MFA later, but it
  owns its schema and migration lifecycle, which places its tables outside
  Article I's `workspace_id` and leak-test requirements and outside Article
  VIII's cascade. Adopting it to obtain two explicitly deferred features is the
  wrong trade.
- **Lucia** — no longer a library, only a reference guide. Following it is this
  decision, with an extra name attached.
- **Auth.js credentials provider** — designed around federated providers; its
  database adapter schema is again not ours, and the credentials flow is the
  least-supported path in it.
