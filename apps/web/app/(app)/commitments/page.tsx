"use client";

import { Amount, Table, type TableColumn } from "@finance/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc/browser.js";
import { useRequireSession } from "../../../lib/use-require-session.js";

interface CommitmentRow {
  id: string;
  name: string;
  direction: "income" | "expense";
  categoryName: string;
  sourceAccountName: string;
  rhythm: "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_off";
  currentAmount: { minor: string; currency: string };
}

/**
 * T085: the commitment list. Empty-state explanation per the edge case: a
 * category and an account must exist before a commitment can.
 */
export default function CommitmentsPage() {
  const ready = useRequireSession();
  const t = useTranslations("commitments.list");
  const tRhythm = useTranslations("commitments.rhythm");

  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [hasAccount, setHasAccount] = useState(true);
  const [hasCategory, setHasCategory] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void Promise.all([
      trpc.commitments.list.query({}),
      trpc.accounts.list.query({}),
      trpc.categories.list.query({}),
    ]).then(([commitmentList, accounts, categories]) => {
      setCommitments(commitmentList);
      setHasAccount(accounts.length > 0);
      setHasCategory(categories.length > 0);
      setLoaded(true);
    });
  }, [ready]);

  const columns: TableColumn<CommitmentRow>[] = [
    { key: "name", header: t("columnName"), render: (row) => row.name },
    { key: "category", header: t("columnCategory"), render: (row) => row.categoryName },
    { key: "account", header: t("columnAccount"), render: (row) => row.sourceAccountName },
    { key: "rhythm", header: t("columnRhythm"), render: (row) => tRhythm(row.rhythm) },
    {
      key: "amount",
      header: t("columnAmount"),
      align: "end",
      render: (row) => (
        <Amount
          value={{ minor: BigInt(row.currentAmount.minor), currency: row.currentAmount.currency }}
          direction={row.direction}
          directionLabel={row.direction === "income" ? t("directionIncome") : t("directionExpense")}
        />
      ),
    },
    {
      key: "actions",
      header: t("columnActions"),
      render: (row) => (
        <Link href={`/commitments/${row.id}`} className="btn btn--ghost">
          {t("editAction")}
        </Link>
      ),
    },
  ];

  if (!ready || !loaded) return null;

  if (!hasAccount || !hasCategory) {
    return (
      <section>
        <h1>{t("title")}</h1>
        <p>{t("needsSetupFirst")}</p>
        <p>
          <Link href="/settings/accounts" className="btn btn--secondary">
            {t("goToAccounts")}
          </Link>{" "}
          <Link href="/settings/categories" className="btn btn--secondary">
            {t("goToCategories")}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>
        <Link href="/commitments/new" className="btn btn--primary">
          {t("createLink")}
        </Link>
      </p>
      <Table
        columns={columns}
        rows={commitments}
        getRowKey={(row) => row.id}
        caption={t("title")}
        emptyMessage={t("empty")}
      />
    </section>
  );
}
