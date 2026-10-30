/**
 * A commitment is active in month `m` when `m >= startMonth` and, where an
 * end month exists, `m <= endMonth` — both month indices, per
 * `monthOfIsoDate`'s reduction. There is no day-level comparison anywhere:
 * a commitment starting 15 March is active in March at its full amount,
 * never prorated (FR-026, FR-026a).
 */
export function isActiveInMonth(
  month: number,
  startMonth: number,
  endMonth: number | null,
): boolean {
  if (month < startMonth) return false;
  if (endMonth !== null && month > endMonth) return false;
  return true;
}
