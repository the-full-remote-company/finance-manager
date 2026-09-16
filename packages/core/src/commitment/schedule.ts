/**
 * Activity window and due-month arithmetic, per research.md Part B2/B3.
 *
 * A commitment is active in month `m` when `m >= startMonth` and, where an
 * end month exists, `m <= endMonth`. Due months for a periodic rhythm are
 * `anchor + k * period` for integer `k` (`k` may be negative, which is what
 * lets an anchor predate the start date and still be a legal phase marker).
 */
export type Rhythm = "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_off";

const PERIOD_MONTHS: Readonly<Record<Exclude<Rhythm, "one_off">, number>> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export function isActiveInMonth(
  month: number,
  startMonth: number,
  endMonth: number | null,
): boolean {
  if (month < startMonth) return false;
  if (endMonth !== null && month > endMonth) return false;
  return true;
}

/**
 * Whether `month` is a due month for this rhythm/anchor. Does not itself check
 * activity — callers combine this with `isActiveInMonth`, per B3's "restricted
 * to months where the commitment is active".
 */
export function isDueMonth(month: number, rhythm: Rhythm, anchorMonth: number | null): boolean {
  if (rhythm === "monthly") return true;
  if (anchorMonth === null) {
    // The database's `commitments_anchor_required` CHECK forbids this state;
    // reached only if a caller bypasses it. No due month is the safe answer.
    return false;
  }
  if (rhythm === "one_off") return month === anchorMonth;

  const period = PERIOD_MONTHS[rhythm];
  // A true modulo, not JavaScript's remainder: (month - anchor) is negative
  // for every month before the anchor, and floor-style wrapping is what keeps
  // those months landing on the correct earlier period boundary (B4).
  return (((month - anchorMonth) % period) + period) % period === 0;
}

/** Every due month for a commitment within `[from, to]`, inclusive, restricted to its active months. */
export function dueMonthsInRange(
  from: number,
  to: number,
  rhythm: Rhythm,
  anchorMonth: number | null,
  startMonth: number,
  endMonth: number | null,
): number[] {
  const months: number[] = [];
  for (let month = from; month <= to; month += 1) {
    if (isActiveInMonth(month, startMonth, endMonth) && isDueMonth(month, rhythm, anchorMonth)) {
      months.push(month);
    }
  }
  return months;
}

export interface EffectiveDatedAmount {
  readonly effectiveMonth: number;
}

/**
 * The amount whose effective month is the greatest at-or-before `month`, per
 * research.md B6. `null` when every amount is still in the future relative to
 * `month` — a state the "earliest amount at or before the start month"
 * invariant (enforced at creation) prevents for any of a commitment's own
 * active months, but which a generic caller must still handle honestly.
 */
export function amountInForce<T extends EffectiveDatedAmount>(
  amounts: readonly T[],
  month: number,
): T | null {
  let best: T | null = null;
  for (const amount of amounts) {
    if (
      amount.effectiveMonth <= month &&
      (best === null || amount.effectiveMonth > best.effectiveMonth)
    ) {
      best = amount;
    }
  }
  return best;
}
