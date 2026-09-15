/**
 * Exact allocation, per Article II: "Division and allocation (splitting a bill,
 * prorating a budget) MUST NOT lose or invent minor units; allocation functions
 * MUST prove that the parts sum exactly to the whole."
 *
 * research B5: integer `base` and `remainder`, then one extra minor unit to
 * each of the first `remainder` parts. Earliest-part-first is the documented
 * tie-break, which in a smoothed period means the earliest month.
 *
 * A running fractional remainder is rejected outright by Article II, so there
 * is no float anywhere in this file.
 */
export function allocate(totalMinor: bigint, parts: number): bigint[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(
      `allocate() requires a positive integer number of parts, received ${String(parts)}`,
    );
  }
  if (totalMinor < 0n) {
    throw new RangeError(
      `allocate() requires a non-negative total, received ${totalMinor.toString()}`,
    );
  }

  const divisor = BigInt(parts);
  const base = totalMinor / divisor;
  const remainder = totalMinor % divisor;

  const shares: bigint[] = new Array<bigint>(parts);
  for (let index = 0; index < parts; index += 1) {
    shares[index] = BigInt(index) < remainder ? base + 1n : base;
  }
  return shares;
}
