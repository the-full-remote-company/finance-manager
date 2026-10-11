/**
 * `dashboard.month`'s payload, per contracts/procedures.md, computed as one
 * pure function over a workspace's full commitment set for a single target
 * month. No projection row is persisted anywhere (research B9): every call
 * recomputes from `commitments`, `commitment_amounts` and `amount_overrides`.
 *
 * FR-032: a reserve commitment (`kind: "reserve"`) never appears in
 * `expenseCategories` or `expenseTotal`; it appears only under
 * `reserveCategories` / `reservesTotal`. A category holding both kinds of
 * commitment appears in both arrays, each with only its matching lines.
 *
 * Presentation (T111, User Story 4): `cash` shows a commitment's full amount
 * exactly in its due months, never prorated (FR-026a), and nowhere else.
 * `smoothed` instead shows every *active* month an equal per-month share of
 * the charge, split across the whole rhythm period rather than however many
 * of its months are active (FR-028a) — a `one_off` commitment is the one
 * exception, per Story 4 scenario 7: it is never smoothed, in either
 * presentation, since it has no period to spread across. For a `monthly`
 * commitment the two presentations are mathematically identical (period 1),
 * which is why this distinction was invisible throughout User Story 3.
 */
import { amountInForce } from "../commitment/schedule.js";
import { addMoney, money, subtractMoney, sumMoney, type Money } from "../money/money.js";
import { percentOfIncome, type ExactRational } from "../money/percentage.js";
import {
  isDueMonth,
  isPeriodic,
  periodMonths,
  periodStart,
  smoothedShareForMonth,
  type Rhythm,
} from "../projection/index.js";
import { isActiveInMonth } from "../time/activity-window.js";

export type Presentation = "cash" | "smoothed";

export interface AggregateCommitment {
  readonly id: string;
  readonly name: string;
  readonly direction: "income" | "expense";
  readonly kind: "expense" | "reserve";
  readonly categoryId: string;
  readonly categoryName: string;
  readonly rhythm: Rhythm;
  readonly anchorMonth: number | null;
  readonly startMonth: number;
  readonly endMonth: number | null;
}

export interface AggregateAmount {
  readonly commitmentId: string;
  readonly effectiveMonth: number;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface AggregateOverride {
  readonly commitmentId: string;
  readonly month: number;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface AggregateInput {
  readonly month: number;
  readonly presentation: Presentation;
  readonly currency: string;
  readonly commitments: readonly AggregateCommitment[];
  readonly amounts: readonly AggregateAmount[];
  readonly overrides: readonly AggregateOverride[];
}

export interface IncomeLine {
  readonly commitmentId: string;
  readonly name: string;
  readonly categoryId: string;
  readonly amount: Money;
}

export interface ExpenseLine {
  readonly commitmentId: string;
  readonly name: string;
  readonly amount: Money;
  readonly isDue: boolean;
}

export interface CategoryTotal {
  readonly categoryId: string;
  readonly name: string;
  readonly total: Money;
  readonly percentOfIncome: ExactRational | null;
  readonly lines: readonly ExpenseLine[];
}

export interface DashboardMonth {
  readonly month: number;
  readonly presentation: Presentation;
  readonly currency: string;
  readonly income: { readonly total: Money; readonly lines: readonly IncomeLine[] };
  readonly expenseCategories: readonly CategoryTotal[];
  readonly expenseTotal: Money;
  readonly reservesTotal: Money;
  readonly reserveCategories: readonly CategoryTotal[];
  readonly combinedTotal: Money;
  readonly remaining: Money;
}

/** The amount in force for one commitment at `month`: an override wins, else the latest amount at or before it. */
function resolveAmount(
  commitmentId: string,
  month: number,
  amounts: readonly AggregateAmount[],
  overrides: readonly AggregateOverride[],
  currency: string,
): Money | null {
  const override = overrides.find((o) => o.commitmentId === commitmentId && o.month === month);
  if (override) return money(override.amountMinor, override.currency);

  const forCommitment = amounts.filter((a) => a.commitmentId === commitmentId);
  const inForce = amountInForce(forCommitment, month);
  if (inForce) return money(inForce.amountMinor, inForce.currency);

  // No amount has ever been established at or before this month. The
  // creation invariant (earliest amount at or before the start month)
  // prevents this for any of a commitment's own active months; zero is the
  // safe answer for a caller that bypasses it.
  return money(0n, currency);
}

function groupByCategory(
  commitments: readonly AggregateCommitment[],
  activeDue: ReadonlyMap<string, { amount: Money; isDue: boolean }>,
  incomeTotalMinor: bigint,
): CategoryTotal[] {
  const byCategory = new Map<string, { name: string; lines: ExpenseLine[] }>();

  for (const commitment of commitments) {
    const resolved = activeDue.get(commitment.id);
    if (!resolved) continue;

    const bucket = byCategory.get(commitment.categoryId) ?? {
      name: commitment.categoryName,
      lines: [],
    };
    bucket.lines.push({
      commitmentId: commitment.id,
      name: commitment.name,
      amount: resolved.amount,
      isDue: resolved.isDue,
    });
    byCategory.set(commitment.categoryId, bucket);
  }

  const result: CategoryTotal[] = [];
  for (const [categoryId, bucket] of byCategory) {
    const total = sumMoney(
      bucket.lines.map((line) => line.amount),
      bucket.lines[0]?.amount.currency,
    );
    result.push({
      categoryId,
      name: bucket.name,
      total,
      percentOfIncome: percentOfIncome(total.minor, incomeTotalMinor),
      lines: bucket.lines,
    });
  }
  return result;
}

/**
 * The resolved figure for one active commitment at `month`, per
 * `presentation`. `null` when the commitment contributes nothing this
 * month — the cash view (and a `one_off` in either view) simply has no line
 * outside its due month.
 */
function resolveLine(
  commitment: AggregateCommitment,
  month: number,
  presentation: Presentation,
  amounts: readonly AggregateAmount[],
  overrides: readonly AggregateOverride[],
  currency: string,
): { amount: Money; isDue: boolean } | null {
  if (presentation === "cash" || !isPeriodic(commitment.rhythm)) {
    const due = isDueMonth(month, commitment.rhythm, commitment.anchorMonth);
    if (!due) return null;
    const amount = resolveAmount(commitment.id, month, amounts, overrides, currency);
    if (!amount) return null;
    return { amount, isDue: true };
  }

  // Smoothed, periodic rhythm: every active month gets a share, not only the
  // due month. `anchorMonth` is `null` only for `monthly` (schema-enforced),
  // whose period is 1 — the anchor value is then mathematically irrelevant
  // (periodStart(m, anything, 1) === m), so `month` is a safe stand-in.
  const period = periodMonths(commitment.rhythm);
  const anchor = commitment.anchorMonth ?? month;
  const start = periodStart(month, anchor, period);
  // The due month this period's charge is resolved at. If the period's own
  // boundary precedes the commitment's start (it started part-way through a
  // period), there is no amount history before the start month — the
  // creation invariant only guarantees one at-or-before the start itself.
  const amountLookupMonth = Math.max(start, commitment.startMonth);
  const dueAmount = resolveAmount(commitment.id, amountLookupMonth, amounts, overrides, currency);
  if (!dueAmount) return null;

  const shareMinor = smoothedShareForMonth(month, start, period, dueAmount.minor);
  return { amount: money(shareMinor, dueAmount.currency), isDue: month === start };
}

export function aggregateMonth(input: AggregateInput): DashboardMonth {
  const { month, presentation, currency, commitments, amounts, overrides } = input;

  const incomeLines: IncomeLine[] = [];
  // commitmentId -> resolved line, restricted to active commitments with a
  // non-null figure this month (FR-026: only whole active months count).
  const expenseResolved = new Map<string, { amount: Money; isDue: boolean }>();
  const reserveResolved = new Map<string, { amount: Money; isDue: boolean }>();

  for (const commitment of commitments) {
    const active = isActiveInMonth(month, commitment.startMonth, commitment.endMonth);
    if (!active) continue;

    const resolved = resolveLine(commitment, month, presentation, amounts, overrides, currency);
    if (!resolved) continue;

    if (commitment.direction === "income") {
      incomeLines.push({
        commitmentId: commitment.id,
        name: commitment.name,
        categoryId: commitment.categoryId,
        amount: resolved.amount,
      });
    } else if (commitment.kind === "reserve") {
      reserveResolved.set(commitment.id, resolved);
    } else {
      expenseResolved.set(commitment.id, resolved);
    }
  }

  const income = {
    total: sumMoney(
      incomeLines.map((line) => line.amount),
      currency,
    ),
    lines: incomeLines,
  };

  const expenseCategories = groupByCategory(commitments, expenseResolved, income.total.minor);
  const reserveCategories = groupByCategory(commitments, reserveResolved, income.total.minor);

  const expenseTotal = sumMoney(
    expenseCategories.map((category) => category.total),
    currency,
  );
  const reservesTotal = sumMoney(
    reserveCategories.map((category) => category.total),
    currency,
  );
  const combinedTotal = addMoney(expenseTotal, reservesTotal);
  const remaining = subtractMoney(income.total, combinedTotal);

  return {
    month,
    presentation,
    currency,
    income,
    expenseCategories,
    expenseTotal,
    reservesTotal,
    reserveCategories,
    combinedTotal,
    remaining,
  };
}
