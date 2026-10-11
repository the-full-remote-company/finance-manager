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
 * Presentation note: `presentation` is accepted now so the contract's shape
 * is stable, but only the `cash` path is implemented here — a commitment's
 * full amount appears exactly in its due months, never prorated (FR-026a),
 * and nowhere else. True smoothing (dividing a charge across its whole
 * rhythm period, FR-027/FR-028) is T111's extension of this same function
 * for User Story 4; until then `smoothed` computes identically to `cash`,
 * which happens to already be correct for every monthly-rhythm commitment
 * since its period is one month.
 */
import { amountInForce, isDueMonth, type Rhythm } from "../commitment/schedule.js";
import { addMoney, money, subtractMoney, sumMoney, type Money } from "../money/money.js";
import { percentOfIncome, type ExactRational } from "../money/percentage.js";
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

export function aggregateMonth(input: AggregateInput): DashboardMonth {
  const { month, presentation, currency, commitments, amounts, overrides } = input;

  const incomeLines: IncomeLine[] = [];
  // commitmentId -> resolved line, restricted to active-and-due commitments
  // (FR-026: only whole active months count; the cash view shows a charge
  // only in its due months).
  const expenseResolved = new Map<string, { amount: Money; isDue: boolean }>();
  const reserveResolved = new Map<string, { amount: Money; isDue: boolean }>();

  for (const commitment of commitments) {
    const active = isActiveInMonth(month, commitment.startMonth, commitment.endMonth);
    if (!active) continue;

    const due = isDueMonth(month, commitment.rhythm, commitment.anchorMonth);
    if (!due) continue;

    const amount = resolveAmount(commitment.id, month, amounts, overrides, currency);
    if (!amount) continue;

    if (commitment.direction === "income") {
      incomeLines.push({
        commitmentId: commitment.id,
        name: commitment.name,
        categoryId: commitment.categoryId,
        amount,
      });
    } else if (commitment.kind === "reserve") {
      reserveResolved.set(commitment.id, { amount, isDue: due });
    } else {
      expenseResolved.set(commitment.id, { amount, isDue: due });
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
