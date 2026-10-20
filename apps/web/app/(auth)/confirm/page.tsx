"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useId, useState, type SubmitEvent } from "react";
import { toAppClientError, trpc } from "../../../lib/trpc/browser.js";

/**
 * Feature 002, User Story 1: the page the emailed link opens.
 *
 * Opening it confirms nothing (FR-006). A mail scanner or link-preview bot
 * can GET this page freely; the account is only confirmed when a person
 * presses the button, which is the only thing that calls `auth.confirm`.
 *
 * Every refusal, expired, used, superseded, unknown, malformed or missing
 * token alike, reaches the same state: one explanation and a form to ask for
 * a new link (FR-007). The form never says whether the address is registered
 * (FR-009).
 */
function ConfirmForm() {
  const t = useTranslations("auth.confirm");
  const tErrors = useTranslations("auth.errors");
  const router = useRouter();
  const token = useSearchParams().get("token");

  const emailId = useId();

  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState(token === null || token === "");
  const [genericError, setGenericError] = useState(false);

  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  function announce(message: string) {
    document.getElementById("live-region")?.replaceChildren(message);
  }

  async function handleConfirm() {
    if (token === null || token === "") {
      setRefused(true);
      return;
    }

    setConfirming(true);
    setGenericError(false);

    try {
      await trpc.auth.confirm.mutate({ token });
      announce(t("confirmedMessage"));
      router.push("/dashboard");
      return;
    } catch (error) {
      const appError = toAppClientError(error);

      if (appError?.appCode === "TOKEN_INVALID") {
        setRefused(true);
      } else if (appError?.appCode === "ALREADY_CONFIRMED") {
        // A successful outcome from the person's point of view: nothing to
        // fix, just sign in.
        router.push("/sign-in");
        return;
      } else {
        setGenericError(true);
      }
    }
    setConfirming(false);
  }

  async function handleResend(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendError(null);
    setResending(true);

    try {
      await trpc.auth.resendConfirmation.mutate({ email: resendEmail });
      setResendSent(true);
      announce(t("resendSent"));
    } catch (error) {
      const appError = toAppClientError(error);
      if (appError?.appCode === "RATE_LIMITED") {
        const seconds = Number(appError.details?.["retryAfterSeconds"] ?? 0);
        setResendError(tErrors("rateLimited", { seconds }));
      } else if (appError?.appCode === "VALIDATION_FAILED") {
        setResendError(tErrors("validationFailed"));
      } else {
        setResendError(tErrors("generic"));
      }
    } finally {
      setResending(false);
    }
  }

  if (refused) {
    return (
      <div>
        <h1>{t("title")}</h1>
        <p role="alert">{tErrors("tokenInvalid")}</p>

        {resendSent ? (
          <p role="status">{t("resendSent")}</p>
        ) : (
          <form onSubmit={(event) => void handleResend(event)} noValidate>
            <div className="field">
              <label htmlFor={emailId}>{t("resendEmailLabel")}</label>
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={resendEmail}
                aria-invalid={resendError === null ? undefined : true}
                aria-describedby={resendError === null ? undefined : `${emailId}-error`}
                onChange={(event) => {
                  setResendEmail(event.target.value);
                }}
              />
              {resendError === null ? null : (
                <p id={`${emailId}-error`} role="alert">
                  {resendError}
                </p>
              )}
            </div>
            <button type="submit" className="btn btn--primary btn--block" disabled={resending}>
              {resending ? t("resendingButton") : t("resendButton")}
            </button>
          </form>
        )}

        <p>
          <Link href="/sign-in">{t("switchToSignIn")}</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("instructions")}</p>

      {genericError ? <p role="alert">{tErrors("generic")}</p> : null}

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => void handleConfirm()}
        disabled={confirming}
      >
        {confirming ? t("confirming") : t("confirmButton")}
      </button>

      <p>
        <Link href="/sign-in">{t("switchToSignIn")}</Link>
      </p>
    </div>
  );
}

// `useSearchParams` needs a Suspense boundary or the production build refuses
// to prerender the route.
export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmForm />
    </Suspense>
  );
}
