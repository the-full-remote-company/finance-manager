"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { toAppClientError, trpc } from "../../../lib/trpc/browser.js";

/**
 * Story 1 scenario 4: a wrong password and an unknown address produce the
 * identical generic failure, so the form never distinguishes them either.
 */
export default function SignInPage() {
  const t = useTranslations("auth.signIn");
  const tErrors = useTranslations("auth.errors");
  const router = useRouter();

  const emailId = useId();
  const passwordId = useId();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const timer = setTimeout(() => {
      setRetryAfterSeconds((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [retryAfterSeconds]);

  function announce(message: string) {
    document.getElementById("live-region")?.replaceChildren(message);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      await trpc.auth.signIn.mutate({ email, password });
      router.push("/dashboard");
    } catch (error) {
      const appError = toAppClientError(error);

      if (appError?.appCode === "AUTH_FAILED") {
        // Never distinguishes "unknown address" from "wrong password"
        // (Story 1 scenario 4, ADR 0003): one message, and focus returns to
        // the password field rather than either field specifically, since
        // naming one would itself be the disclosure.
        setFormError(tErrors("authFailed"));
        passwordRef.current?.focus();
      } else if (appError?.appCode === "ACCOUNT_NOT_CONFIRMED") {
        // Feature 002: account exists but email not yet confirmed
        setUnconfirmedEmail(email);
        setFormError(tErrors("accountNotConfirmed"));
      } else if (appError?.appCode === "VALIDATION_FAILED") {
        setFormError(tErrors("validationFailed"));
        emailRef.current?.focus();
      } else if (appError?.appCode === "RATE_LIMITED") {
        const seconds = Number(appError.details?.["retryAfterSeconds"] ?? 0);
        setRetryAfterSeconds(seconds);
        const message = tErrors("rateLimited", { seconds });
        setFormError(message);
        announce(message);
      } else {
        setFormError(tErrors("generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const throttled = retryAfterSeconds !== null && retryAfterSeconds > 0;

  async function handleResendConfirmation() {
    if (!unconfirmedEmail) return;
    setResending(true);
    try {
      await trpc.auth.resendConfirmation.mutate({ email: unconfirmedEmail });
      // Replaces the stale "not confirmed" message so the result is visible,
      // not only announced.
      setFormError(t("resendSuccess"));
      announce(t("resendSuccess"));
      setUnconfirmedEmail(null);
    } catch (error) {
      const appError = toAppClientError(error);
      if (appError?.appCode === "RATE_LIMITED") {
        const seconds = Number(appError.details?.["retryAfterSeconds"] ?? 0);
        announce(tErrors("rateLimited", { seconds }));
      } else {
        announce(tErrors("generic"));
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>{t("title")}</h1>

      <div className="field">
        <label htmlFor={emailId}>{t("emailLabel")}</label>
        <input
          id={emailId}
          ref={emailRef}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={passwordId}>{t("passwordLabel")}</label>
        <input
          id={passwordId}
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>

      {formError === null ? null : (
        <div role="alert">
          <p>{formError}</p>
          {unconfirmedEmail && (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => void handleResendConfirmation()}
              disabled={resending}
            >
              {resending ? t("resendingButton") : t("resendButton")}
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={submitting || throttled}
      >
        {submitting ? t("submitting") : t("submit")}
      </button>

      <p>
        <Link href="/register">{t("switchToRegister")}</Link>
      </p>
    </form>
  );
}
