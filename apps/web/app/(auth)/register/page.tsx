"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { toAppClientError, trpc } from "../../../lib/trpc/browser.js";

/**
 * Story 1: registration. contracts/procedures.md's `auth.register` returns
 * the identical success shape for a genuine success and for a colliding
 * email (ADR 0003) — there is no "this address is taken" branch to render,
 * by design. Only validation and throttling are distinguishable errors here.
 */
export default function RegisterPage() {
  const t = useTranslations("auth.register");
  const tErrors = useTranslations("auth.errors");
  const router = useRouter();

  const displayNameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const displayNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // The throttle countdown, announced via the live region layout.tsx renders
  // (Article IV: the countdown must be perceivable, not just visible).
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
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      await trpc.auth.register.mutate({ displayName, email, password });
      setSucceeded(true);
      announce(t("success"));
    } catch (error) {
      const appError = toAppClientError(error);

      if (appError?.appCode === "VALIDATION_FAILED") {
        const path = appError.details?.path;
        const field = Array.isArray(path) && typeof path[0] === "string" ? path[0] : undefined;
        setFormError(tErrors("validationFailed"));
        if (field === "displayName" || field === "email" || field === "password") {
          setFieldErrors({ [field]: tErrors("validationFailed") });
          const refs = { displayName: displayNameRef, email: emailRef, password: passwordRef };
          refs[field].current?.focus();
        }
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

  useEffect(() => {
    if (succeeded) router.prefetch("/dashboard");
  }, [succeeded, router]);

  if (succeeded) {
    return <p role="status">{t("success")}</p>;
  }

  const throttled = retryAfterSeconds !== null && retryAfterSeconds > 0;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>{t("title")}</h1>

      <div className="field">
        <label htmlFor={displayNameId}>{t("displayNameLabel")}</label>
        <input
          id={displayNameId}
          ref={displayNameRef}
          type="text"
          autoComplete="name"
          required
          value={displayName}
          aria-invalid={fieldErrors["displayName"] === undefined ? undefined : true}
          aria-describedby={
            fieldErrors["displayName"] === undefined ? undefined : `${displayNameId}-error`
          }
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
        {fieldErrors["displayName"] === undefined ? null : (
          <p id={`${displayNameId}-error`} role="alert">
            {fieldErrors["displayName"]}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={emailId}>{t("emailLabel")}</label>
        <input
          id={emailId}
          ref={emailRef}
          type="email"
          autoComplete="email"
          required
          value={email}
          aria-invalid={fieldErrors["email"] === undefined ? undefined : true}
          aria-describedby={fieldErrors["email"] === undefined ? undefined : `${emailId}-error`}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        {fieldErrors["email"] === undefined ? null : (
          <p id={`${emailId}-error`} role="alert">
            {fieldErrors["email"]}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={passwordId}>{t("passwordLabel")}</label>
        <input
          id={passwordId}
          ref={passwordRef}
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          aria-invalid={fieldErrors["password"] === undefined ? undefined : true}
          aria-describedby={`${passwordId}-hint${fieldErrors["password"] === undefined ? "" : ` ${passwordId}-error`}`}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <p id={`${passwordId}-hint`}>{t("passwordHint")}</p>
        {fieldErrors["password"] === undefined ? null : (
          <p id={`${passwordId}-error`} role="alert">
            {fieldErrors["password"]}
          </p>
        )}
      </div>

      {formError === null ? null : <p role="alert">{formError}</p>}

      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={submitting || throttled}
      >
        {submitting ? t("submitting") : t("submit")}
      </button>

      <p>
        <Link href="/sign-in">{t("switchToSignIn")}</Link>
      </p>
    </form>
  );
}
