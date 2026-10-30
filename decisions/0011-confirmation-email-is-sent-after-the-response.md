# 11. The confirmation email is sent after the response, not during it

Date: 2026-10-20

## Status

Accepted. Needs human review: it changes timing on the authentication path
(ADR 0003).

## Context

ADR 0003 and feature 002's FR-009 and FR-011 require that a caller cannot tell
whether an address is registered, from the response or from its timing. The
first implementation of `auth.register` and `auth.resendConfirmation` awaited
the SMTP conversation inside the request. A real SMTP exchange takes tens to
thousands of milliseconds, and a hung provider takes as long as the mailer's
timeout. Only a genuine registration or an unconfirmed address sends mail, so
the response time alone said whether the address was known.

Measured with a mailer that takes 150 ms, the figure real providers sit well
above:

| Procedure | Case | Median, awaited send | Median, send after response |
|---|---|---|---|
| `resendConfirmation` | unconfirmed | 155.6 ms | 3.0 to 4.0 ms |
| `resendConfirmation` | confirmed or unknown | 1.7 ms | 0.9 to 1.3 ms |
| `register` | genuine | 169.1 ms | 13.6 to 16.1 ms |
| `register` | duplicate | 17 to 20 ms | 12.9 to 15.2 ms |

(Right-hand columns: five runs of the committed tests.) A hung provider made a
registration wait 8039 ms, exactly the greeting timeout.

## Decision

1. The send is started after the database work has committed, and the response
   does not wait for it (`sendInBackground` in `packages/api/src/routers/auth.ts`).
   `sendConfirmationEmail` already logs its own failures and does not reject;
   the wrapper's `catch` covers a broken promise of that, and logs nothing that
   identifies the recipient.
2. `register` writes the workspace, the user and the first token in one
   transaction. A duplicate fails at the user insert, so the work before the
   collision is the same, and an account can no longer exist without a token.
3. The token is generated on every path, duplicate or not, before the
   collision is known. It costs microseconds.

## Residual, stated precisely

The two cases are not bit-for-bit identical, and this does not claim they are:

- `resendConfirmation`: an unconfirmed address does one write transaction that
  the other cases do not, about 2 to 3 ms (3.0 to 4.0 ms against 0.9 to 1.3 ms).
- `register`: a genuine registration does one more insert than a duplicate,
  about 1 ms, on top of an argon2id hash of about 14 ms that both do.

The tests (`resend-timing`, `register-enumeration`) assert a tolerance of 40 ms.
That is far below the 150 ms they simulate, so they fail if the send is awaited
again, and above what a CI machine can hold stable, so they cannot assert a
2 ms difference. A caller would need many samples from many source addresses
(the throttle is per address and source) to measure it through network jitter.

## Alternatives considered

- **Do all of `resendConfirmation`'s work after the response**, so the response
  is the throttle check and a constant. This removes the 2 to 3 ms. Rejected for
  now: it needs a way for tests to wait for background work and moves failures
  out of the request. Revisit if the threat model includes distributed timing
  measurement.
- **Pad the cheap paths with a sleep.** Fragile: it must track provider latency,
  which varies by orders of magnitude.
- **An outbox table and a worker.** The right shape if mail volume grows. It
  adds infrastructure Article VII asks us not to add before it is needed.
- **Keep awaiting.** This is the oracle.

## Consequences

- If the process exits between the response and the send, the email is lost.
  The person's remedy is the resend action (FR-008), which is why this is
  acceptable here and would not be for mail with no way to ask again.
- This relies on a long-lived server process, which is the self-hosted
  deployment Article VII requires. On a runtime that suspends once it has
  responded, the send must move to that platform's post-response hook or a queue.
- Tests observe that the mailer was called straight after the response, because
  the call is made before the handler returns. Only its completion is later.
- `mail-hang.test.ts` runs the real mailer against a server that accepts and
  never speaks, and asserts registration and resend answer within 2 s.

## Verification of `auth.register` against ADR 0003 (T032)

Each property is asserted by a test, not by reading the code:

| Property | Test |
|---|---|
| The password is hashed once per attempt, duplicates included, before the collision is known | `register-duplicate-behavior`: "does the same password-hashing work" |
| The duplicate's response has the same shape; its ids are fabricated and point at nothing | `register-enumeration`; `register-confirmation` |
| No session, no cookie, no email, no audit row, no workspace or token for a duplicate | `register-duplicate-behavior`; `register-enumeration` |
| A duplicate spends exactly the throttle budget a genuine registration does | `register-duplicate-behavior`: "each spend exactly one unit" |
| Timing class | `register-enumeration` (tolerance and residual above) |
| What a person sees is identical, and the owner of a confirmed address gets no notice | `us3-enumeration.spec.ts` |
