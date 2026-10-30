"use client";

import { DatePicker, Select } from "@finance/ui";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type SubmitEvent } from "react";
import { toAppClientError, trpc } from "../../../../lib/trpc/browser.js";
import { useRequireSession } from "../../../../lib/use-require-session.js";

type Direction = "income" | "expense";
type Kind = "expense" | "reserve";
type Rhythm = "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_off";

interface Option {
  id: string;
  name: string;
}

/**
 * T085 (completed retroactively, prompted by T115/US5): the commitment edit
 * form — `commitments.update`'s fields, same shape as the create form minus
 * the amount (amounts have their own history, edited elsewhere per US8's
 * T140, not rewritten here). This is what makes "flip a commitment's kind"
 * (Story 5 scenario 4) and any other field correction possible at all.
 */
export default function EditCommitmentPage() {
  const ready = useRequireSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations("commitments.form");
  const tErrors = useTranslations("commitments.errors");
  const tRhythm = useTranslations("commitments.rhythm");

  const [accounts, setAccounts] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
  const [kind, setKind] = useState<Kind>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [rhythm, setRhythm] = useState<Rhythm>("monthly");
  const [anchorMonth, setAnchorMonth] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();

  useEffect(() => {
    if (!ready) return;
    void Promise.all([
      trpc.accounts.list.query({}),
      trpc.categories.list.query({}),
      trpc.commitments.get.query({ id: params.id }),
    ])
      .then(([accountList, categoryList, commitment]) => {
        setAccounts(accountList);
        setCategories(categoryList);
        setName(commitment.name);
        setDirection(commitment.direction);
        setKind(commitment.kind);
        setCategoryId(commitment.categoryId);
        setSourceAccountId(commitment.sourceAccountId);
        setTransferAccountId(commitment.transferAccountId ?? "");
        setRhythm(commitment.rhythm);
        setAnchorMonth(commitment.anchorMonth ?? "");
        setStartDate(commitment.startDate);
        setEndDate(commitment.endDate ?? "");
        setLoaded(true);
      })
      .catch(() => {
        setNotFound(true);
        setLoaded(true);
      });
  }, [ready, params.id]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      await trpc.commitments.update.mutate({
        id: params.id,
        name,
        direction,
        kind,
        categoryId,
        sourceAccountId,
        transferAccountId: transferAccountId.length > 0 ? transferAccountId : null,
        rhythm,
        anchorMonth: rhythm === "monthly" ? undefined : anchorMonth,
        startDate,
        endDate: endDate.length > 0 ? endDate : null,
      });
      router.push("/commitments");
    } catch (error) {
      const appError = toAppClientError(error);
      switch (appError?.appCode) {
        case "ANCHOR_REQUIRED":
          setFormError(tErrors("anchorRequired"));
          break;
        case "TRANSFER_EQUALS_SOURCE":
          setFormError(tErrors("transferEqualsSource"));
          break;
        case "END_BEFORE_START":
          setFormError(tErrors("endBeforeStart"));
          break;
        case "DIRECTION_MISMATCH":
          setFormError(tErrors("directionMismatch"));
          break;
        case "VALIDATION_FAILED":
          setFormError(tErrors("validationFailed"));
          break;
        default:
          setFormError(tErrors("generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || !loaded) return null;
  if (notFound) return <p role="alert">{tErrors("generic")}</p>;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>{t("editTitle")}</h1>

      <div className="field">
        <label htmlFor={nameId}>{t("nameLabel")}</label>
        <input
          id={nameId}
          type="text"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <Select
        id="commitment-direction"
        label={t("directionLabel")}
        value={direction}
        onChange={(value) => {
          const next = value === "income" ? "income" : "expense";
          setDirection(next);
          if (next === "income") setKind("expense");
        }}
        options={[
          { value: "expense", label: t("directionExpense") },
          { value: "income", label: t("directionIncome") },
        ]}
      />

      {direction === "expense" && (
        <Select
          id="commitment-kind"
          label={t("kindLabel")}
          value={kind}
          onChange={(value) => {
            setKind(value === "reserve" ? "reserve" : "expense");
          }}
          options={[
            { value: "expense", label: t("kindExpense") },
            { value: "reserve", label: t("kindReserve") },
          ]}
        />
      )}

      <Select
        id="commitment-category"
        label={t("categoryLabel")}
        value={categoryId}
        onChange={setCategoryId}
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
      />

      <Select
        id="commitment-source-account"
        label={t("sourceAccountLabel")}
        value={sourceAccountId}
        onChange={setSourceAccountId}
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
      />

      <Select
        id="commitment-transfer-account"
        label={t("transferAccountLabel")}
        value={transferAccountId}
        onChange={setTransferAccountId}
        options={[
          { value: "", label: t("transferAccountNone") },
          ...accounts.map((account) => ({ value: account.id, label: account.name })),
        ]}
      />

      <Select
        id="commitment-rhythm"
        label={t("rhythmLabel")}
        value={rhythm}
        onChange={(value) => {
          setRhythm(value as Rhythm);
        }}
        options={[
          { value: "monthly", label: tRhythm("monthly") },
          { value: "quarterly", label: tRhythm("quarterly") },
          { value: "half_yearly", label: tRhythm("half_yearly") },
          { value: "yearly", label: tRhythm("yearly") },
          { value: "one_off", label: tRhythm("one_off") },
        ]}
      />

      {rhythm !== "monthly" && (
        <div className="field">
          <label htmlFor="commitment-anchor-month">{t("anchorMonthLabel")}</label>
          <input
            id="commitment-anchor-month"
            type="month"
            required
            value={anchorMonth}
            onChange={(event) => {
              setAnchorMonth(event.target.value);
            }}
          />
        </div>
      )}

      <DatePicker
        id="commitment-start-date"
        label={t("startDateLabel")}
        value={startDate}
        onChange={setStartDate}
      />
      <DatePicker
        id="commitment-end-date"
        label={t("endDateLabel")}
        value={endDate}
        onChange={setEndDate}
      />

      {formError !== null && <p role="alert">{formError}</p>}

      <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
        {submitting ? t("editSubmitting") : t("editSubmit")}
      </button>
    </form>
  );
}
