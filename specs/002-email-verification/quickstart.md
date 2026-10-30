# Quickstart: Email Verification

**Feature**: `002-email-verification`

How to run, exercise and verify the confirmation flow locally, and how to point
it at a real provider. Every command here was run before it was written down.

## Local mail

Registration sends a link by SMTP. Locally, [Mailpit](https://mailpit.axllent.org)
catches it; nothing leaves the machine.

```bash
docker compose up -d db mailpit    # Mailpit: SMTP 1025, web UI and API 8025
pnpm db:reset
```

`.env.local` needs these (copy from `.env.example`):

```text
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=noreply@finance-manager.local
APP_BASE_URL=http://localhost:3000
```

Use `127.0.0.1`, not `localhost`. On Docker Desktop Node tries `::1` first and
the IPv6 port proxy intermittently hangs: 6 of 12 sends timed out when measured.

Check the transport on its own, then read the message at <http://localhost:8025>:

```bash
pnpm --filter @finance/auth mail:test you@example.test
```

## Try the flow by hand

1. `pnpm dev`, open <http://localhost:3000/register>, register.
2. The screen says a link was sent and shows the address. You are not signed in
   and `/dashboard` sends you to `/sign-in`.
3. Open the message in Mailpit and follow the link. Opening it confirms
   nothing; press **Konto bestätigen**.
4. You land on `/dashboard`.

Things worth trying: press **Bestätigungs-E-Mail erneut senden** and confirm the
first link has stopped working; sign in before confirming (you are told the
account is unconfirmed, and offered a resend, only if the password was right);
register the same address again and compare the two screens.

## Confirmed or unconfirmed?

```bash
docker exec finance-db psql -U owner -d finance \
  -c "select email, confirmed, confirmed_at from users order by created_at desc limit 5;"
```

Accounts that existed before this feature are `confirmed = true`; a new
registration is `false` until its link is used.

## Verifying a change

```bash
pnpm exec vitest run --project integration packages/api/tests/auth   # needs the db only; Mailpit is not used
pnpm test:isolation                                  # confirmation_tokens leak test
pnpm exec playwright test --workers=1               # needs db and mailpit
```

Three specs deliberately use the real mailer: `mail-failure` (nothing listening
on the port) and `mail-hang` (a server that accepts and never speaks), so the
failure paths are real sockets, not mocks.

## A real provider

The mailer is `nodemailer` over SMTP and reads only environment variables, so
the provider is swappable (Article VII). Use a transactional provider: a
self-hosted mail server's deliverability and reputation risk is the wrong trade
for security-relevant mail.

| Variable | Postmark | Amazon SES |
|---|---|---|
| `SMTP_HOST` | `smtp.postmarkapp.com` | `email-smtp.<region>.amazonaws.com` |
| `SMTP_PORT` | `587` (STARTTLS) | `587` (STARTTLS) |
| `SMTP_USER` | Server API token | SMTP username (IAM-derived, not your AWS key) |
| `SMTP_PASS` | Server API token | SMTP password |
| `SMTP_FROM` | A verified sender signature | A verified identity |

Port `465` uses implicit TLS. Set `APP_BASE_URL` to the public origin: it is the
origin of the link in the email. Secrets live in the environment only
(Article VIII); a committed one must be rotated.

The provider accounts and credentials are yours to create; none are assumed here.

## Behaviour to know about

- The email is sent after the response (ADR 0011). If the process exits in
  between, the mail is lost and the person's remedy is the resend button.
- A failed send is logged as machine codes only, never the address or the link.
- Resend and registration share the sign-in throttle (`auth_attempts`).
