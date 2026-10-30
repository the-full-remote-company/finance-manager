"use client";

import { Amount } from "@finance/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../../../lib/trpc/browser.js";
import { useRequireSession } from "../../../lib/use-require-session.js";

type Presentation = "cash" | "smoothed";

type MoneyOut = { minor: string; currency: string };

interface Line {
  commitmentId: string;
  name: string;
  amount: MoneyOut;
  isDue: boolean;
}

interface IncomeLine {
  commitmentId: string;
  name: string;
  categoryId: string;
  amount: MoneyOut;
}

interface CategoryTotal {
  categoryId: string;
  name: string;
  total: MoneyOut;
  percentOfIncome: { numerator: string; denominator: string } | null;
  lines: Line[];
}

interface DashboardMonth {
  month: string;
  presentation: Presentation;
  currency: string;
  income: { total: MoneyOut; lines: IncomeLine[] };
  expenseCategories: CategoryTotal[];
  expenseTotal: MoneyOut;
  reservesTotal: MoneyOut;
  reserveCategories: CategoryTotal[];
  combinedTotal: MoneyOut;
  remaining: MoneyOut;
  retrievedAt: string;
}

interface Horizon {
  firstMonth: string;
  lastMonth: string;
  currentMonth: string;
}

const PRESENTATION_STORAGE_KEY = "finance.dashboard.presentation";

function addMonthString(month: string, delta: number): string {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const total = year * 12 + monthIndex + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

function formatPercent(percent: { numerator: string; denominator: string } | null): string | null {
  if (!percent) return null;
  const numerator = Number(percent.numerator);
  const denominator = Number(percent.denominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  // The one display boundary where a percentage is rounded (Article II):
  // packages/core never rounds it, Intl.NumberFormat does, here.
  return new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(
    numerator / denominator,
  );
}

/**
 * T095-T097: the month dashboard. Income list with its total, expense
 * category rows with totals and percentages, the overall expense total and
 * the remaining figure (all through `@finance/ui`'s `Amount`), a month
 * navigator that stops at the horizon boundary, and a background prefetch of
 * the neighbouring months so a switch is local (SC-006).
 */
export default function DashboardPage() {
  const ready = useRequireSession();
  const t = useTranslations("dashboard");
  const router = useRouter();

  const [horizon, setHorizon] = useState<Horizon | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation>("cash");
  const [data, setData] = useState<DashboardMonth | null>(null);
  const [offline, setOffline] = useState(false);

  // Cache keyed by `${month}:${presentation}` so a prefetched neighbour makes
  // the next navigation instant rather than a fresh round trip (SC-006).
  const cache = useRef(new Map<string, DashboardMonth>());

  // FR-030: the chosen presentation is retained across navigation and
  // sessions.
  useEffect(() => {
    const stored = window.localStorage.getItem(PRESENTATION_STORAGE_KEY);
    if (stored === "cash" || stored === "smoothed") setPresentation(stored);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void trpc.dashboard.horizon.query().then((result) => {
      setHorizon(result);
      setMonth((current) => current ?? result.currentMonth);
    });
  }, [ready]);

  const load = useCallback((targetMonth: string, targetPresentation: Presentation) => {
    const key = `${targetMonth}:${targetPresentation}`;
    const cached = cache.current.get(key);
    if (cached) {
      setData(cached);
      setOffline(false);
      return;
    }
    trpc.dashboard.month
      .query({ month: targetMonth, presentation: targetPresentation })
      .then((result) => {
        cache.current.set(key, result);
        setData(result);
        setOffline(false);
      })
      .catch(() => {
        // Offline and never cached for this month: FR-035e's "not available
        // offline" (distinct from "no data") is left to the e2e-tested
        // service worker; here the dashboard simply has nothing to show.
        setOffline(true);
      });
  }, []);

  useEffect(() => {
    if (!month) return;
    load(month, presentation);
  }, [month, presentation, load]);

  // T097: prefetch the neighbouring months in the background.
  useEffect(() => {
    if (!month || !horizon) return;
    const prevMonth = addMonthString(month, -1);
    const nextMonth = addMonthString(month, 1);
    if (prevMonth >= horizon.firstMonth) {
      void trpc.dashboard.month
        .query({ month: prevMonth, presentation })
        .then((result) => cache.current.set(`${prevMonth}:${presentation}`, result))
        .catch(() => undefined);
    }
    if (nextMonth <= horizon.lastMonth) {
      void trpc.dashboard.month
        .query({ month: nextMonth, presentation })
        .then((result) => cache.current.set(`${nextMonth}:${presentation}`, result))
        .catch(() => undefined);
    }
  }, [month, presentation, horizon]);

  function choosePresentation(next: Presentation) {
    setPresentation(next);
    window.localStorage.setItem(PRESENTATION_STORAGE_KEY, next);
  }

  function goToMonth(delta: number) {
    if (!month || !horizon) return;
    const next = addMonthString(month, delta);
    if (next < horizon.firstMonth || next > horizon.lastMonth) return;
    setMonth(next);
  }

  async function handleSignOut(): Promise<void> {
    await trpc.auth.signOut.mutate({});
    // Offline support is read-only and device-local (ADR 0006): nothing here
    // is a personal record that must outlive the session, so the simplest
    // correct action on sign-out is to destroy every cache outright rather
    // than selectively invalidate one. A later sign-in on the same device
    // starts with no stale figures left over from the previous account.
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    router.push("/sign-in");
  }

  if (!ready || !horizon || !month) return null;

  const atFirst = month <= horizon.firstMonth;
  const atLast = month >= horizon.lastMonth;

  return (
    <section>
      <h1>{t("title")}</h1>
      <p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void handleSignOut();
          }}
        >
          {t("signOut")}
        </button>
      </p>

      <div className="seg" role="group" aria-label={t("presentationLabel")}>
        <button
          type="button"
          aria-pressed={presentation === "cash"}
          onClick={() => {
            choosePresentation("cash");
          }}
        >
          {t("presentationCash")}
        </button>
        <button
          type="button"
          aria-pressed={presentation === "smoothed"}
          onClick={() => {
            choosePresentation("smoothed");
          }}
        >
          {t("presentationSmoothed")}
        </button>
      </div>
      {/* T113: FR-028b means the two views can legitimately disagree over a
          partially covered period — explained once, near the toggle that
          switches between them, rather than left for the user to notice as
          an apparent inconsistency. */}
      <p>
        {presentation === "smoothed" ? t("presentationSmoothedHint") : t("presentationCashHint")}
      </p>

      <div className="seg" role="group" aria-label={t("monthNavLabel")} data-testid="month-nav">
        <button
          type="button"
          disabled={atFirst}
          onClick={() => {
            goToMonth(-1);
          }}
          aria-label={t("monthPrev")}
        >
          ‹
        </button>
        <button type="button" aria-pressed disabled data-testid="month-label">
          {month}
        </button>
        <button
          type="button"
          disabled={atLast}
          onClick={() => {
            goToMonth(1);
          }}
          aria-label={t("monthNext")}
        >
          ›
        </button>
      </div>
      {atFirst ? <p role="status">{t("horizonBoundaryFirst")}</p> : null}
      {atLast ? <p role="status">{t("horizonBoundaryLast")}</p> : null}

      {offline ? <p role="status">{t("notAvailableOffline")}</p> : null}

      {data ? (
        <>
          {/* Not `.balance`: that card is white-on-accent, and `.amt--gain` /
              `.amt--loss` are tuned for the page background — nesting one in
              the other fails WCAG contrast (found by the e2e a11y scan).
              `.amt`'s own tabular, bold styling already sets this apart from
              body text without it. */}
          <p>
            <strong>{t("remainingLabel")}</strong>{" "}
            <Amount
              value={{ minor: BigInt(data.remaining.minor), currency: data.remaining.currency }}
              direction={data.remaining.minor.startsWith("-") ? "expense" : "income"}
              directionLabel={
                data.remaining.minor.startsWith("-")
                  ? t("remainingNegative")
                  : t("remainingPositive")
              }
            />
          </p>

          {/* T100: a staleness indicator, not a money figure — `.pill` with
              neither `--gain` nor `--loss` (research Part C; Article V
              reserves those for literal money direction). */}
          <p role="status" className="pill" data-testid="retrieved-at">
            {t("retrievedAt", { time: new Date(data.retrievedAt).toLocaleString("de-DE") })}
          </p>

          <h2>{t("incomeTitle")}</h2>
          {data.income.lines.length === 0 ? (
            <p>{t("incomeEmpty")}</p>
          ) : (
            <div className="list">
              {data.income.lines.map((line) => (
                <div className="row" key={line.commitmentId}>
                  <div className="row__main">
                    <div className="row__t">{line.name}</div>
                  </div>
                  <Amount
                    value={{ minor: BigInt(line.amount.minor), currency: line.amount.currency }}
                    direction="income"
                    directionLabel={t("directionIncome")}
                  />
                </div>
              ))}
            </div>
          )}
          <p>
            {t("incomeTotalLabel")}{" "}
            <Amount
              value={{
                minor: BigInt(data.income.total.minor),
                currency: data.income.total.currency,
              }}
              direction="income"
              directionLabel={t("directionIncome")}
            />
          </p>

          <h2>{t("expensesTitle")}</h2>
          {data.expenseCategories.length === 0 ? (
            <p>{t("expensesEmpty")}</p>
          ) : (
            <div className="list">
              {data.expenseCategories.map((category) => {
                const percent = formatPercent(category.percentOfIncome);
                return (
                  <div className="row" key={category.categoryId}>
                    <div className="row__main">
                      <div className="row__t">{category.name}</div>
                      {percent ? (
                        <span className="pill" data-testid={`percent-${category.categoryId}`}>
                          {percent}
                        </span>
                      ) : null}
                    </div>
                    <Amount
                      value={{
                        minor: BigInt(category.total.minor),
                        currency: category.total.currency,
                      }}
                      direction="expense"
                      directionLabel={t("directionExpense")}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <p>
            {t("expenseTotalLabel")}{" "}
            <Amount
              value={{
                minor: BigInt(data.expenseTotal.minor),
                currency: data.expenseTotal.currency,
              }}
              direction="expense"
              directionLabel={t("directionExpense")}
            />
          </p>

          {data.reserveCategories.length > 0 ? (
            <>
              <h2>{t("reservesTitle")}</h2>
              <div className="list">
                {data.reserveCategories.map((category) => (
                  <div className="row" key={category.categoryId}>
                    <div className="row__main">
                      <div className="row__t">{category.name}</div>
                      {/* T118: a reserve is money set aside, not spent —
                          status, not money direction, so this is a `.pill`
                          with neither `--gain` nor `--loss` (research Part C,
                          Article V). */}
                      <span className="pill">{t("reservePillLabel")}</span>
                    </div>
                    <Amount
                      value={{
                        minor: BigInt(category.total.minor),
                        currency: category.total.currency,
                      }}
                      direction="expense"
                      directionLabel={t("directionExpense")}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
