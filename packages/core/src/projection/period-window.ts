/**
 * The rhythm period containing a given month, per research Part B4.
 *
 *     periodStart = anchor + floor((m - anchor) / period) * period
 *
 * A true floor, not truncation toward zero: `(m - anchor)` is negative for
 * every month before the anchor, and `Math.floor` on that negative quotient
 * is what lands those months in the correct earlier period boundary rather
 * than off by one period. `-1 / 3` truncates to `0` but floors to `-1` —
 * the difference is exactly the bug this function exists to avoid.
 *
 * `periodStart` is always itself a due month (it is `anchor + k * period`
 * for the integer `k` found above), which is what lets the smoothing
 * calculation in `smoothing.ts` resolve "the charge for this period" simply
 * by looking up the amount in force at `periodStart`.
 */
export function periodStart(month: number, anchorMonth: number, period: number): number {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, received ${String(period)}`);
  }
  const k = Math.floor((month - anchorMonth) / period);
  return anchorMonth + k * period;
}

export function periodEnd(periodStartMonth: number, period: number): number {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, received ${String(period)}`);
  }
  return periodStartMonth + period - 1;
}
