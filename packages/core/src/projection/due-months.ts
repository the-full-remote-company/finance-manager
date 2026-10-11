/**
 * Due-month arithmetic, per research Part B2/B3.
 *
 * A due month for a periodic rhythm is `anchor + k * period` for integer
 * `k` — `k` may be negative, which is what lets an anchor predate a
 * commitment's start date and still be a legal phase marker (FR-029 edge
 * case: the first due month actually reached is the first occurrence on or
 * after the start month, enforced by combining this with the activity
 * window, never by special-casing the anchor itself).
 */
import { isActiveInMonth } from "../time/activity-window.js";
import { periodMonths, type Rhythm } from "./rhythm.js";

/**
 * Whether `month` is a due month for this rhythm/anchor. Does not itself
 * check activity — callers combine this with `isActiveInMonth`.
 */
export function isDueMonth(month: number, rhythm: Rhythm, anchorMonth: number | null): boolean {
  if (rhythm === "monthly") return true;
  if (anchorMonth === null) {
    // The database's `commitments_anchor_required` CHECK forbids this state;
    // reached only if a caller bypasses it. No due month is the safe answer.
    return false;
  }
  if (rhythm === "one_off") return month === anchorMonth;

  const period = periodMonths(rhythm);
  // A true modulo, not JavaScript's remainder: (month - anchor) is negative
  // for every month before the anchor, and floor-style wrapping is what
  // keeps those months landing on the correct earlier period boundary.
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
