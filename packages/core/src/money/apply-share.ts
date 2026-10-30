/**
 * FR-039 / FR-039a: round each commitment's share to whole minor units at the
 * point the share is applied, half-up, identically everywhere.
 *
 * This is the only place in the repository where a share is rounded. Article II
 * requires rounding to be explicit at the point it occurs, which is why the
 * arithmetic is inline and named rather than delegated.
 *
 * research B7: `floor((amount * pct * 2 + 100) / 200)` in bigint.
 *
 *   amount * pct / 100            is the exact share
 *   (amount * pct * 2 + 100) / 200 is that value plus one half, floored
 *
 * bigint division truncates toward zero; the amount is non-negative here
 * (FR-020), so truncation and floor coincide and half-up is exact.
 */
export function applyShare(amountMinor: bigint, sharePercent: number): bigint {
  if (!Number.isInteger(sharePercent)) {
    throw new RangeError(
      `applyShare() requires an integer share, received ${String(sharePercent)}`,
    );
  }
  if (sharePercent < 0 || sharePercent > 100) {
    throw new RangeError(
      `applyShare() requires a share between 0 and 100, received ${String(sharePercent)}`,
    );
  }
  if (amountMinor < 0n) {
    throw new RangeError(
      `applyShare() requires a non-negative amount, received ${amountMinor.toString()}`,
    );
  }

  return (amountMinor * BigInt(sharePercent) * 2n + 100n) / 200n;
}
