# Procedure Contracts

**Feature**: `002-email-verification`

Conventions in [README.md](./README.md). Error codes in [errors.md](./errors.md).

This feature modifies existing `auth` procedures and adds new ones. All other procedures from feature 001 are unchanged.

---

## `auth` (modified and new)

### `auth.register` — mutation, unauthenticated (MODIFIED)

Creates an **unconfirmed** user and their workspace. **No session is created.** A confirmation email is sent to the provided address.

```text
in   { email: string(email), password: string(min 12), displayName: string(1..120) }
out  { userId: uuid, workspaceId: uuid }
```

**Changes from feature 001**:
- User is created with `confirmed = false` (FR-001).
- No session cookie is set (FR-001).
- A confirmation email is sent containing a single-use link (FR-002).
- If email send fails, the error is logged but not shown to the caller. The account is still created (FR-017).

**Unchanged**:
- Response shape is identical to feature 001 (enumeration resistance).
- A duplicate email returns the same shape and timing class as success. **No session is created, no email is sent** (FR-011).
- Password is hashed before the collision check, so timing does not reveal duplicates (FR-011).
- Rate-limited via `auth_attempts` (existing mechanism).

**Audit events**:
- Registration itself is not audited (unchanged from feature 001).
- Failed email sends are logged (application log, not `audit_events`).

Errors: `VALIDATION_FAILED`, `RATE_LIMITED`.

Implements FR-001, FR-002, FR-011, FR-017.

---

### `auth.signIn` — mutation, unauthenticated (MODIFIED)

```text
in   { email: string(email), password: string }
out  { workspaceId: uuid }
```

**Changes from feature 001**:
- After password verification succeeds, checks `confirmed`. If `false`, returns `ACCOUNT_NOT_CONFIRMED` error instead of creating a session (FR-020).
- If password is wrong, returns `AUTH_FAILED` regardless of confirmation state (FR-020, enumeration resistance).

**Unchanged**:
- Sets the `__Host-session` cookie on success (confirmed accounts only).
- Appends `sign_in_succeeded` or `sign_in_failed` to `audit_events` (FR-020: both unconfirmed and wrong-password cases are audited as `sign_in_failed` with null workspace, as before).

**Error precedence** (from highest to lowest):
1. `RATE_LIMITED` — checked first, before any DB read
2. `VALIDATION_FAILED` — malformed input
3. `AUTH_FAILED` — wrong password, unknown email, or throttled (generic, no detail)
4. `ACCOUNT_NOT_CONFIRMED` — email+password correct, but `confirmed = false`

Errors: `AUTH_FAILED`, `ACCOUNT_NOT_CONFIRMED`, `RATE_LIMITED`, `VALIDATION_FAILED`.

Implements FR-004, FR-005, FR-006, FR-020.

---

### `auth.confirm` — mutation, unauthenticated (NEW)

Confirms an account using the token from the confirmation email. On success, marks the account confirmed and creates a session.

```text
in   { token: string }   // `<workspaceId>.<secret>`, the `token` query param of the email link (ADR 0009)
out  { workspaceId: uuid, userId: uuid }
```

**Behavior**:
- Splits the value into `<workspaceId>.<secret>` (a malformed value is `TOKEN_INVALID`), opens a transaction scoped to that workspace, and looks up the SHA-256 hash of `<secret>` in `confirmation_tokens` under ordinary row-level security. No `SECURITY DEFINER` function is involved (ADR 0009, FR-004).
- Validates: `expires_at > now()`, `superseded_at IS NULL`, and the user is still unconfirmed (FR-005, FR-007).
- If valid: sets `users.confirmed = true`, `users.confirmed_at = now()`, marks the token used (or deletes it), creates a session, sets the `__Host-session` cookie, and returns the workspace+user IDs (FR-005).
- If token is valid but account is already confirmed: returns `ALREADY_CONFIRMED` (not an error from the user's perspective; client redirects to sign-in).
- If token is invalid, expired, or superseded: returns `TOKEN_INVALID` (FR-007).

**Confirmation happens on button press, not page load** (FR-006): The `/confirm?token=...` page loads with the token in the URL, displays "Click to confirm your account", and only on button click does it call `auth.confirm`. This prevents link scanners and email previewers from consuming tokens.

**Audit event**: Appends `account_confirmed` with `workspace_id`, `user_id`, and `ip` on success. Appends `confirmation_failed` (with reason in details) on `TOKEN_INVALID` or `ALREADY_CONFIRMED`.

**Idempotency**: Calling this twice with the same token fails the second time with `TOKEN_INVALID` (token is marked used or deleted after first success).

Errors: `TOKEN_INVALID`, `ALREADY_CONFIRMED`, `VALIDATION_FAILED`.

Implements FR-004, FR-005, FR-006, FR-007, FR-015.

---

### `auth.resendConfirmation` — mutation, unauthenticated (NEW)

Invalidates all previous confirmation tokens for the given email and sends a new confirmation email.

```text
in   { email: string(email) }
out  { ok: true }
```

**Behavior**:
- Looks up the email (case-insensitive, as in `auth.register`).
- If email exists and account is unconfirmed: marks all existing tokens for that user with `superseded_at = now()`, issues a new token, sends the new confirmation email (FR-008).
- If email exists and account is already confirmed: returns `{ ok: true }` without sending anything (FR-009, enumeration resistance).
- If email does not exist: returns `{ ok: true }` without sending anything (FR-009, enumeration resistance).
- Rate-limited via `auth_attempts` on `email` + `ip`, using the existing `AUTH_RATE_LIMIT` threshold (FR-010).

**Response is always the same** regardless of whether the email is registered, confirmed, or unknown (FR-009). The caller has no way to distinguish the three cases from the response or its timing.

**Audit event**: Appends `confirmation_resent` with `workspace_id`, `user_id`, and `ip` when an email is actually sent (unconfirmed account). Appends nothing when the email is unknown or already confirmed (enumeration resistance: no record that the attempt was made for a non-existent or confirmed account).

**Email send failure**: Logged but does not change the response (FR-017). Caller always sees `{ ok: true }`.

Errors: `RATE_LIMITED`, `VALIDATION_FAILED`.

Implements FR-008, FR-009, FR-010, FR-015, FR-017.

---

### `auth.signOut` — mutation (unchanged)

No changes from feature 001. Included here for completeness.

```text
in   {}
out  { ok: true }
```

Deletes the session, clears the cookie, appends `signed_out`. Client must purge caches (FR-035e, verified end-to-end).

Implements FR-035e, FR-006.

---

### `auth.session` — query (unchanged)

No changes from feature 001.

```text
in   {}
out  { userId: uuid, workspaceId: uuid, displayName: string, locale: string } | null
```

Returns `null` when unauthenticated. Only confirmed users have sessions, so this never returns a session for an unconfirmed account (by construction: `auth.register` and `auth.signIn` don't create sessions for them).

Implements FR-004.

---

## Requirement coverage

| Requirement | Procedure(s) |
|---|---|
| FR-001 | `auth.register` |
| FR-002 | `auth.register` |
| FR-003 | token validity enforced in `auth.confirm` |
| FR-004 | token hashing in `auth.confirm`, `auth.resendConfirmation` |
| FR-005 | `auth.confirm` |
| FR-006 | `/confirm` page (button press), `auth.confirm` |
| FR-007 | `auth.confirm` (TOKEN_INVALID) |
| FR-008 | `auth.resendConfirmation` |
| FR-009 | `auth.resendConfirmation` (same response for all cases) |
| FR-010 | `auth.resendConfirmation` (rate limit) |
| FR-011 | `auth.register` (duplicate handling) |
| FR-012 | `/register` success screen (UI, not a procedure) |
| FR-013 | `/confirm` page after success (router.push) |
| FR-014 | `de.json` strings (UI, not a procedure) |
| FR-015 | audit events in `auth.confirm`, `auth.resendConfirmation` |
| FR-016 | email send via nodemailer (implementation detail) |
| FR-017 | `auth.register`, `auth.resendConfirmation` (failed sends logged, not shown) |
| FR-018 | raw tokens never logged (implementation detail) |
| FR-019 | migration (not a procedure) |
| FR-020 | `auth.signIn` (ACCOUNT_NOT_CONFIRMED path) |

All 20 functional requirements are covered by procedures, UI changes, or migration.
