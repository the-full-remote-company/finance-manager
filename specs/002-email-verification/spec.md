# Feature Specification: Email Verification for Registration

**Feature Branch**: `002-email-verification`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Email verification for registration: new accounts stay pending (no session) until the user clicks a confirmation link sent via SMTP; link expires after a reasonable window; unconfirmed accounts can request a resend; confirmed accounts behave as today, including the existing enumeration-resistant registration response (ADR 0003 — a response must not reveal whether an email is already registered)."

## Clarifications

### Session 2026-10-15

- Q: Should accounts created before this feature ships (feature 001 users) be required to confirm their email? → A: No. Grandfathered as confirmed by the migration. Only new registrations need confirmation.
- Q: What should sign-in to an unconfirmed account return? → A: With the correct password, tell the user the account is unconfirmed and offer a resend. With a wrong password, return the generic failure. The password check runs first, so this reveals only what the caller already knows.

## User Scenarios & Testing *(mandatory)*

Registration today creates a signed-in session immediately and sends nothing. The success
screen tells the user to check their email, but no email is sent and the page never leaves
the bare success message. This feature makes registration real: the account exists but
cannot be used until the address is proven to belong to the person registering.

### User Story 1 - Confirm email before first use (Priority: P1)

A new person registers. They see a message telling them to check their inbox. They receive
an email with a confirmation link, click it, and are signed in and taken to their dashboard.
Until they click the link, they have no session and cannot reach any workspace data.

**Why this priority**: This is the whole feature. Without it, anyone can register an address
they do not own and create a workspace under it. It also removes the current broken
post-registration state.

**Independent Test**: Register a new address. Verify no session cookie is set and `/dashboard`
is not reachable. Open the link from the email. Verify the account is confirmed, a session is
created, and the browser lands on `/dashboard`.

**Acceptance Scenarios**:

1. **Given** no account exists for an address, **When** a person registers, **Then** an
   unconfirmed account and workspace are created, a confirmation email is sent to that
   address, and no session cookie is set.
2. **Given** a registration has just succeeded, **When** the success screen is shown,
   **Then** it reads as a deliberate "check your email" state with the address shown and a
   resend action, not as a bare status line.
3. **Given** an unconfirmed account, **When** the person opens the confirmation link within
   its validity window, **Then** the account is marked confirmed, a session is created, and
   the browser is taken to `/dashboard`.
4. **Given** a confirmation link, **When** it is used a second time, **Then** the system
   does not create a session from it and tells the person the link is no longer valid.
5. **Given** a confirmation link older than its validity window, **When** it is opened,
   **Then** no session is created, and the person is offered a resend.

---

### User Story 2 - Resend a confirmation email (Priority: P2)

A person who did not receive the email, or whose link expired, can ask for a new one.

**Why this priority**: Without it, a mistyped address or a lost email locks the person out
permanently. It is the recovery path for Story 1.

**Independent Test**: Register, do not click the link, request a resend. Verify a new link is
emailed, the previous link stops working, and repeated resend requests are throttled.

**Acceptance Scenarios**:

1. **Given** an unconfirmed account, **When** the person requests a resend, **Then** a new
   confirmation email is sent and every earlier confirmation link for that account stops
   working.
2. **Given** any address, **When** a resend is requested, **Then** the response is identical
   whether or not an account exists and whether or not it is already confirmed.
3. **Given** repeated resend requests for one address or from one client, **When** the
   threshold is exceeded, **Then** further requests are throttled with the same generic
   response.

---

### User Story 3 - Registration does not reveal existing accounts (Priority: P1)

Registering an address that already has an account, confirmed or not, looks the same to the
person registering as registering a new address.

**Why this priority**: ADR 0003 requires enumeration resistance. Email verification adds a
new state (pending), and that state must not become a new way to probe for accounts.

**Independent Test**: Compare the registration response and its timing for a new address and
for an existing confirmed address and an existing unconfirmed address. The response shape
must be identical. Timing must fall in the same class.

**Acceptance Scenarios**:

1. **Given** an address already registered and confirmed, **When** someone registers with it,
   **Then** the response matches a genuine new registration, and no session is created.
2. **Given** an address already registered but unconfirmed, **When** someone registers with
   it, **Then** the response matches a genuine new registration, and no new account is
   created.
3. **Given** a duplicate registration, **When** it is processed, **Then** the same work is
   done as for a genuine registration (password hashing included) so timing does not
   distinguish the two.
4. **Given** an existing address, **When** its owner did not register it, **Then** the owner
   is not sent a confirmation email on the other person's behalf, unless the duplicate path
   is explicitly specified as sending a notice (see Assumptions).

---

### User Story 4 - Confirmed accounts behave as today (Priority: P2)

Once confirmed, an account signs in, signs out and uses the app exactly as before this
feature.

**Why this priority**: The change must not regress the existing sign-in and session behaviour
of feature 001.

**Independent Test**: Run the existing sign-in, sign-out and session-expiry scenarios from
feature 001 against a confirmed account. All must pass unchanged.

**Acceptance Scenarios**:

1. **Given** a confirmed account, **When** the person signs in with the correct password,
   **Then** a session is created as before.
2. **Given** a confirmed account, **When** the person signs in with a wrong password, **Then**
   the generic failure is returned and the attempt is audited as before.

---

### Edge Cases

- A confirmation link is opened in a different browser or device from the one that registered:
  the link still confirms the account, and the session is created in the browser that opened
  it.
- Two confirmation links for the same account exist (after a resend): only the most recent is
  valid.
- The email provider is unreachable at registration: the account is still created, the person
  sees the check-email state, and the resend action works once the provider recovers. Failed
  sends are logged, not shown to the person.
- The confirmation link is opened after the account was deleted: the same response as an
  invalid link.
- A person registers, never confirms, and tries to sign in with the correct password: they see
  the "not confirmed" message with a resend action (FR-020). With a wrong password they see the
  generic failure.
- Clicking a confirmation link on a page that loads the dashboard prefetch does not consume
  the link before the person intends it. (Confirmation happens on an explicit page action, not
  on page load, so link previewers and mail scanners cannot confirm accounts silently.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A new registration MUST create an unconfirmed account and its workspace, and MUST
  NOT create a session or set a session cookie.
- **FR-002**: Every new registration MUST send exactly one confirmation email to the registered
  address containing a single-use link.
- **FR-003**: A confirmation link MUST be valid for 24 hours from issue. This window is an
  assumption and may be changed by a clarification.
- **FR-004**: Confirmation tokens MUST be generated with at least 128 bits of randomness, and
  only a hash of each token MUST be stored, following the session-token pattern in ADR 0003.
- **FR-005**: Opening a valid confirmation link MUST mark the account confirmed, invalidate that
  token, and create a session in the opening browser.
- **FR-006**: Confirmation MUST happen on an explicit user action on the confirmation page, not
  on page load, so that automated link scanners cannot confirm accounts.
- **FR-007**: An invalid, expired, already-used or superseded link MUST NOT create a session and
  MUST offer a resend action.
- **FR-008**: A resend request MUST invalidate all previously issued unused confirmation tokens
  for that account.
- **FR-009**: A resend request MUST return the same response whether or not the address is
  registered, and whether or not the account is already confirmed.
- **FR-010**: Registration and resend MUST be rate-limited using the existing `auth_attempts`
  mechanism. No second throttling mechanism may be introduced.
- **FR-011**: A duplicate registration, confirmed or unconfirmed, MUST return the same response
  shape as a genuine registration and MUST do the same password-hashing work, per ADR 0003.
- **FR-012**: The success screen after registration MUST show the address, explain that a link
  was sent, and offer a resend action.
- **FR-013**: After a successful confirmation, the browser MUST navigate to `/dashboard`.
  Navigation MUST use a real route change, not a prefetch. (Fixes the bug in
  `apps/web/app/(auth)/register/page.tsx:89-95`.)
- **FR-014**: The German copy in `apps/web/messages/de.json` MUST describe the actual behaviour:
  an email is sent, the account is active after clicking the link. (Fixes the misleading copy: the old
  screen told the user to check their email while nothing was sent.)
- **FR-015**: Confirmation and resend events MUST be appended to `audit_events`, following the
  audit requirement in ADR 0003. The audit event MUST NOT record whether an address is
  registered in any response shown to a caller.
- **FR-016**: Email delivery MUST use SMTP via `nodemailer`, configured by `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` environment variables. No provider is
  hard-coded.
- **FR-017**: Email send failures MUST be logged and MUST NOT be shown to the person or change the
  registration response.
- **FR-018**: Confirmation tokens MUST NOT appear in logs, audit events or error responses.
- **FR-019**: The migration MUST mark every account that exists before it runs as confirmed, with
  a confirmed-at timestamp set to the migration time. No existing user is asked to confirm.
- **FR-020**: Sign-in to an unconfirmed account MUST check the password first. With a correct
  password, it MUST return a distinct "not confirmed" response that offers a resend and creates no
  session. With a wrong password, it MUST return the generic failure. Both outcomes are audited as
  sign-in failures without a workspace, as in feature 001.

### Key Entities

- **User**: gains a confirmation state (`unconfirmed` or `confirmed`) and a confirmed-at
  timestamp. Only confirmed users can hold a session.
- **Confirmation token**: belongs to a user and a workspace. Stores a hash of the token, an
  expiry timestamp, and a used-or-superseded marker. Tenant-scoped: carries `workspace_id` and
  is covered by a cross-tenant leak test (Article I).

## Assumptions

- Confirmation link validity is 24 hours (FR-003).
- A duplicate registration sends no email to the existing address. Only the registrant sees the
  same generic success response. Notifying the owner of an attempted duplicate registration is
  out of scope for this feature.
- The confirmation email is plain text with a link, in German, matching the app's single locale
  (FR-042 of feature 001).
- Resend throttling reuses the thresholds of `AUTH_RATE_LIMIT` unless a separate value is
  specified during planning.
- Sessions, sign-out and session expiry are unchanged from feature 001.
- Multi-factor authentication and password reset are out of scope.
- This feature touches the authentication path. Per ADR 0003, every change requires mandatory
  human review and is built test-first (Article III).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new registrations produce no session until the confirmation link is
  opened.
- **SC-002**: A person who clicks a valid confirmation link lands on their dashboard with no
  additional steps.
- **SC-003**: For a registration with an address already in use, the response is indistinguishable
  from a genuine new registration in content and status, and differs in response time by no more
  than the normal variance of password hashing.
- **SC-004**: No confirmation link works after its 24-hour validity or after a resend supersedes it.
- **SC-005**: The success screen after registration describes the next step without requiring the
  person to guess what happened.

## Open items for planning

- Resolve both clarification markers above before `/speckit.plan`.
- Plan must identify the migration for existing `users` rows, and the cross-tenant leak test for
  the new confirmation-token table.
- Plan must name the SMTP provider the user will configure (Postmark or AWS SES; see plan.md OQ-1)
  and how local development captures outgoing mail.
