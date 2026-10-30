# Contract Documentation

**Feature**: `002-email-verification`

See [procedures.md](./procedures.md) for the wire contract of each new or modified procedure.

This feature modifies existing `auth` procedures and adds new ones. All wire conventions from [feature 001's contracts/README.md](../../001-recurring-budget-planner/contracts/README.md) apply:

- Money is `{ amount: string, currency: string }`
- Month is `{ year: int, month: int(1..12) }`
- Date is `string` in ISO 8601 `YYYY-MM-DD`
- Percentage is `{ numerator: int, denominator: int }`
- Every mutation returns at minimum `{ ok: true }` or an error
- Every error is `{ code: string, message: string, details?: object }`

Error codes are defined in [errors.md](./errors.md).

## Authentication changes

This feature changes the authentication flow:

- `auth.register` no longer creates a session. It creates an unconfirmed account and sends a confirmation email. Response shape unchanged (enumeration resistance preserved).
- `auth.signIn` checks confirmation state after password verification. Unconfirmed accounts with correct password get a new error code; wrong password still gets `AUTH_FAILED`.
- New procedures: `auth.confirm` (one-time token → session), `auth.resendConfirmation` (invalidates old tokens, sends new email).

All procedures remain tRPC procedures with OpenAPI annotations. The OpenAPI document regenerates from these.
