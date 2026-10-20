import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * T009 — feature 002, FR-002, FR-017, Article VIII.
 * The mailer sends one plain-text German message containing the link, never
 * throws on a transport failure, and never writes the recipient's address or
 * the link (which carries the secret) to any log.
 */
const RECIPIENT = "alice@example.test";
const LINK =
  "https://app.example.test/confirm?token=0b6f1a52-8c3e-4a55-9d1f-3f1d2a7c9e10.SECRETSECRETSECRETSECRET";

const SMTP_ENV = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_FROM: "noreply@example.test",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-password-value",
};

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

async function loadMailer() {
  // The module caches its transporter, so each test needs a fresh instance.
  vi.resetModules();
  vi.doMock("nodemailer", () => ({ createTransport }));
  return import("../src/email.js");
}

type ConsoleSpy = MockInstance<(...args: unknown[]) => void>;

function everythingLogged(spies: ConsoleSpy[]): string {
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join("\n");
}

describe("sendConfirmationEmail", () => {
  let logSpies: ConsoleSpy[];

  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
    for (const [key, value] of Object.entries(SMTP_ENV)) vi.stubEnv(key, value);
    logSpies = (["log", "warn", "error", "info", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("nodemailer");
  });

  describe("when SMTP is configured", () => {
    it("sends exactly one message to the recipient from the configured sender", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
        to: RECIPIENT,
        from: SMTP_ENV.SMTP_FROM,
      });
    });

    it("configures the transport from the environment, with STARTTLS off port 465", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: SMTP_ENV.SMTP_HOST,
          port: 587,
          secure: false,
          auth: { user: SMTP_ENV.SMTP_USER, pass: SMTP_ENV.SMTP_PASS },
        }),
      );
    });

    it("bounds every phase of the SMTP conversation, so a hung provider cannot hang registration", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      const options = (createTransport.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      // nodemailer's defaults are 2 minutes (connect, greeting) and 10 minutes
      // (socket); registration awaits this call.
      for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
        const value = options[key];
        expect(typeof value, key).toBe("number");
        expect(value as number, key).toBeGreaterThan(0);
        expect(value as number, key).toBeLessThanOrEqual(10_000);
      }
    });

    it("uses implicit TLS on port 465", async () => {
      vi.stubEnv("SMTP_PORT", "465");
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
    });

    it("omits auth when no credentials are configured (local Mailpit)", async () => {
      vi.stubEnv("SMTP_USER", "");
      vi.stubEnv("SMTP_PASS", "");
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
    });

    it("sends a plain-text German body containing the link and the 24-hour validity, and no HTML", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      const message = sendMail.mock.calls[0]?.[0] as {
        subject: string;
        text: string;
        html?: string;
      };
      expect(message.text).toContain(LINK);
      expect(message.text).toContain("24 Stunden");
      expect(message.subject).toMatch(/bestätige/i);
      expect(message.html).toBeUndefined();
    });

    it("reuses one transport across sends", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);
      await sendConfirmationEmail("bob@example.test", LINK);

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    it("logs nothing on success", async () => {
      sendMail.mockResolvedValue({});
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("when the transport fails (FR-017)", () => {
    it("resolves instead of throwing, so registration still succeeds", async () => {
      sendMail.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:587"));
      const { sendConfirmationEmail } = await loadMailer();

      await expect(sendConfirmationEmail(RECIPIENT, LINK)).resolves.toBeUndefined();
    });

    it("logs the failure's machine codes so an operator can diagnose it", async () => {
      sendMail.mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:587"), {
          code: "ECONNECTION",
          responseCode: 421,
        }),
      );
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      const logged = everythingLogged(logSpies);
      expect(logged).toContain("ECONNECTION");
      expect(logged).toContain("421");
    });

    it("never writes the recipient, the link or the secret to a log (Article VIII)", async () => {
      // A provider's error text may echo the recipient back; the log must not.
      sendMail.mockRejectedValue(new Error(`550 mailbox ${RECIPIENT} rejected ${LINK}`));
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      const logged = everythingLogged(logSpies);
      expect(logged).not.toContain(RECIPIENT);
      expect(logged).not.toContain("alice");
      expect(logged).not.toContain("SECRETSECRET");
      expect(logged).not.toContain(SMTP_ENV.SMTP_PASS);
    });
  });

  describe("when SMTP is not configured (local development)", () => {
    beforeEach(() => {
      vi.stubEnv("SMTP_HOST", "");
    });

    it("resolves without creating a transport or sending", async () => {
      const { sendConfirmationEmail } = await loadMailer();

      await expect(sendConfirmationEmail(RECIPIENT, LINK)).resolves.toBeUndefined();

      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("never writes the recipient, the link or the secret to a log (Article VIII)", async () => {
      const { sendConfirmationEmail } = await loadMailer();

      await sendConfirmationEmail(RECIPIENT, LINK);

      const logged = everythingLogged(logSpies);
      expect(logged).not.toContain(RECIPIENT);
      expect(logged).not.toContain("alice");
      expect(logged).not.toContain("SECRETSECRET");
    });
  });
});
