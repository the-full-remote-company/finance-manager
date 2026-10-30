/**
 * Smoothing: a periodic charge spread evenly across every month of its whole
 * rhythm period, then clipped to the commitment's active months (FR-028a).
 *
 * Built on `allocate` (Article II) rather than re-deriving a division here:
 * the period's charge is split into exactly `period` shares that sum to the
 * charge exactly, earliest month first for any odd remainder. Critically,
 * the split is always over the *full* period length, never over however
 * many of its months happen to be active — a commitment that ends part-way
 * through a period keeps the unchanged per-month share for its active
 * months and simply omits the rest (edge case, spec.md), which is why that
 * period's smoothed total can be less than the charge (FR-028b) while a
 * fully covered period's smoothed total is always exactly the charge
 * (SC-002).
 */
import { allocate } from "../money/allocate.js";
import { periodStart } from "./period-window.js";

/**
 * The smoothed share for one specific month within its period.
 *
 * `chargeMinor` must already be the amount in force for *this period's* due
 * month (`periodStart`) — resolving which amount that is (history, override,
 * the fallback for a period boundary before the commitment's own start) is
 * the caller's responsibility, same as it is for the cash path.
 */
export function smoothedShareForMonth(
  month: number,
  anchorMonth: number,
  period: number,
  chargeMinor: bigint,
): bigint {
  const start = periodStart(month, anchorMonth, period);
  const shares = allocate(chargeMinor, period);
  const index = month - start;
  const share = shares[index];
  if (share === undefined) {
    // month falls within [start, start + period - 1] by periodStart's own
    // construction; reached only if a caller passes a month outside that
    // range, which indicates a caller bug rather than a domain state.
    throw new RangeError(
      `month ${String(month)} is not within the period starting at ${String(start)}`,
    );
  }
  return share;
}
