"use client";

import { DatePicker, Select } from "@finance/ui";
import { useRouter } from "next/navigation";
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
 * T085: the commitment create form. The anchor field is revealed only for a
 * non-monthly rhythm (FR-014), matching `ANCHOR_REQUIRED`'s backstop.
 */
export default function NewCommitmentPage() {
  const ready = useRequireSession();
  const router = useRouter();
  const t = useTranslations("commitments.form");
  const tErrors = useTranslations("commitments.errors");
  const tRhythm = useTranslations("commitments.rhythm");

  const [accounts, setAccounts] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
  // FR-018: classified as either an expense or a reserve, defaulting to
  // expense. Story 5's distinction (money spent vs. money set aside) only
  // applies to money leaving an account, so the control is shown for an
  // expense-direction commitment only — forced back to "expense" otherwise.
  const [kind, setKind] = useState<Kind>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [rhythm, setRhythm] = useState<Rhythm>("monthly");
  const [anchorMonth, setAnchorMonth] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amountEuros, setAmountEuros] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const amountId = useId();

  useEffect(() => {
    if (!ready) return;
    void Promise.all([trpc.accounts.list.query({}), trpc.categories.list.query({})]).then(
      ([accountList, categoryList]) => {
        setAccounts(accountList);
        setCategories(categoryList);
        if (accountList[0]) setSourceAccountId(accountList[0].id);
        if (categoryList[0]) setCategoryId(categoryList[0].id);
      },
    );
  }, [ready]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const minor = Math.round(Number.parseFloat(amountEuros.replace(",", ".")) * 100).toString();

    try {
      await trpc.commitments.create.mutate({
        name,
        direction,
        kind,
        categoryId,
        sourceAccountId,
        transferAccountId: transferAccountId.length > 0 ? transferAccountId : undefined,
        rhythm,
        anchorMonth: rhythm === "monthly" ? undefined : anchorMonth,
        startDate,
        endDate: endDate.length > 0 ? endDate : undefined,
        initialAmount: { minor, currency: "EUR" },
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

  if (!ready) return null;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>{t("title")}</h1>

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

      <div className="field">
        <label htmlFor={amountId}>{t("amountLabel")}</label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          required
          className="num"
          value={amountEuros}
          onChange={(event) => {
            setAmountEuros(event.target.value);
          }}
        />
      </div>

      {formError !== null && <p role="alert">{formError}</p>}

      <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
