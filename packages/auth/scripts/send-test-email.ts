#!/usr/bin/env node
/**
 * Dev tool: send a test email via configured SMTP.
 * Useful for verifying local Mailpit and production provider setup.
 *
 * Usage:
 *   pnpm node scripts/send-test-email.ts recipient@example.com
 *
 * Requires:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env.local
 */

import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;
const recipient = process.argv[2];

if (!smtpHost || !smtpPort || !smtpFrom || !recipient) {
  console.error("Missing SMTP config or recipient.");
  console.error("Usage: pnpm node scripts/send-test-email.ts recipient@example.com");
  console.error("Requires: SMTP_HOST, SMTP_PORT, SMTP_FROM in .env.local");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: Number(smtpPort),
  secure: Number(smtpPort) === 465,
  auth:
    smtpUser && smtpPass
      ? {
          user: smtpUser,
          pass: smtpPass,
        }
      : undefined,
});

transporter
  .sendMail({
    from: smtpFrom,
    to: recipient,
    subject: "Test Email from Finance Manager",
    text: "This is a test email to verify SMTP configuration.\n\nIf you received this, your email setup is working.",
  })
  .then(() => {
    console.log(`✓ Test email sent to ${recipient}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ Email send failed:", err.message);
    process.exit(1);
  });
