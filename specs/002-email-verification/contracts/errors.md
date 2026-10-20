# Error Contract

**Feature**: `002-email-verification`

All errors from [feature 001's contracts/errors.md](../../001-recurring-budget-planner/contracts/errors.md) remain valid. This feature adds:

## New error codes

### `ACCOUNT_NOT_CONFIRMED`

Returned by `auth.signIn` when the email and password are correct but the account is unconfirmed.

```json
{
  "code": "ACCOUNT_NOT_CONFIRMED",
  "message": "Account not confirmed. Check your email for the confirmation link, or request a new one.",
  "details": {
    "email": "user@example.com"
  }
}
```

**Client handling**: Show the email address and offer a "Resend confirmation email" action that calls `auth.resendConfirmation`.

**NOT returned when**:
- Password is wrong: returns `AUTH_FAILED` as before (enumeration resistance)
- Email is unknown: returns `AUTH_FAILED` as before
- Account is already confirmed: normal sign-in succeeds

### `TOKEN_INVALID`

Returned by `auth.confirm` when the token is expired, already used, superseded by a resend, or does not exist.

```json
{
  "code": "TOKEN_INVALID",
  "message": "This confirmation link is no longer valid. Request a new one.",
  "details": {}
}
```

**Client handling**: Show the message and offer "Resend confirmation email" without requiring the user to sign in (they don't have a session yet). The resend form asks for the email address.

**NOT returned when**:
- Token is valid and not expired: confirmation succeeds, session created
- Account is already confirmed: token is useless but not technically invalid; confirm returns `ALREADY_CONFIRMED` instead

### `ALREADY_CONFIRMED`

Returned by `auth.confirm` when the token is valid but the account is already confirmed (e.g., user clicked the link twice, or confirmed via another browser/device).

```json
{
  "code": "ALREADY_CONFIRMED",
  "message": "This account is already confirmed. You can sign in.",
  "details": {}
}
```

**Client handling**: Redirect to sign-in. Do not show an error; this is a successful outcome from the user's perspective.

## Modified error codes

No existing error codes are modified. `AUTH_FAILED`, `RATE_LIMITED`, and `VALIDATION_FAILED` retain their exact meanings and handling from feature 001.

## Enumeration resistance

Per ADR 0003 and FR-009/FR-011:

- `auth.register` with a duplicate email: same response shape as success, same timing class. No error. No session created. No email sent (the attacker does not get to spam the real owner).
- `auth.signIn` with wrong password: `AUTH_FAILED`, whether or not the email exists, whether or not the account is confirmed.
- `auth.resendConfirmation` with an unknown email: same response shape as success. No error. No email sent.
- `auth.resendConfirmation` with an already-confirmed account: same response shape as success. No error. No email sent.

These are requirements, not error cases. They do not appear in the error list because they are deliberate success responses.
