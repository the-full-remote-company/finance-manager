import { createTransport, type Transporter } from "nodemailer";

/**
 * Email send interface for confirmation links (feature 002).
 * Configured via SMTP env vars for vendor portability (Article VII).
 * Send failures are logged but never shown to the caller (FR-017).
 */

const SMTP_TIMEOUT_MS = 8_000;

interface Mailer {
  transport: Transporter;
  from: string;
}

let mailer: Mailer | null = null;

/**
 * Lazy-initialize the SMTP transporter.
 * Reads SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM from env.
 */
function getMailer(): Mailer | null {
  if (mailer) return mailer;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;

  // If not configured, return null (local dev may not need email)
  if (!host || !port || !from) {
    console.warn(
      "[email] SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_FROM to send emails.",
    );
    return null;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const transport = createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465, // TLS for port 465, STARTTLS for others
    // The request that triggers a send waits for it. nodemailer's defaults
    // (2 min connect/greeting, 10 min socket) would let one stalled provider
    // hang registration for minutes; found when a Mailpit socket stalled for
    // 75 s. FR-017: a failed send is logged, never shown.
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    auth:
      user && pass
        ? {
            user,
            pass,
          }
        : undefined,
  });

  mailer = { transport, from };
  return mailer;
}

/**
 * Send a confirmation email with a one-time link.
 * @param toEmail Recipient email
 * @param confirmationLink Full URL to the confirm page (e.g., https://app.example.com/confirm?token=...)
 * @returns Promise that resolves on success or on logged failure (never rejects)
 *
 * FR-017: Send failures are logged but not shown to the caller.
 * Account creation/resend succeeds even if email send fails.
 */
export async function sendConfirmationEmail(
  toEmail: string,
  confirmationLink: string,
): Promise<void> {
  const configured = getMailer();
  if (!configured) {
    // No recipient in the log line (Article VIII).
    console.log("[email] Skipping send: SMTP not configured (dev mode)");
    return;
  }

  const subject = "Bestätige deine E-Mail-Adresse";
  const text = `
Hallo,

bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren.

Bestätigung: ${confirmationLink}

Dieser Link ist 24 Stunden lang gültig.

Viele Grüße
Finance Manager
`.trim();

  try {
    await configured.transport.sendMail({
      from: configured.from,
      to: toEmail,
      subject,
      text,
    });
    // No logging on success (no customer data)
  } catch (error) {
    // Logged for an operator, never thrown or shown to the user. Deliberately
    // not `error.message`: a provider's text can echo the recipient or the
    // link, which carries the secret (Article VIII). The machine codes are
    // enough to diagnose a transport problem.
    const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
    console.error("[email] Failed to send confirmation", {
      code: typeof code === "string" ? code : "unknown",
      responseCode: typeof responseCode === "number" ? responseCode : undefined,
    });
    // Do not throw: caller (auth.register/resend) continues and returns success.
  }
}
