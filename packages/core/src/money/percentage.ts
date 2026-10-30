/**
 * FR-033: each category total as a percentage of the month's income, suppressed
 * when income is zero.
 *
 * research B8: the domain returns an exact rational and never a rounded number,
 * so the last rounding decision stays in the presentation layer where
 * `Intl.NumberFormat` performs it (Article II). Returning a rounded percentage
 * here would put a display concern in the domain and lose precision the client
 * may want.
 *
 * The fraction is deliberately NOT reduced: `24000/96000` keeps the category
 * total and the income visible in the payload, which a reduced `1/4` discards.
 */

export interface ExactRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export function percentOfIncome(
  categoryTotalMinor: bigint,
  incomeTotalMinor: bigint,
): ExactRational | null {
  if (incomeTotalMinor < 0n) {
    throw new RangeError(`income cannot be negative, received ${incomeTotalMinor.toString()}`);
  }
  if (incomeTotalMinor === 0n) {
    // Suppressed, not zero and not an error: dividing by zero income is the
    // question FR-033 exists to refuse.
    return null;
  }
  return { numerator: categoryTotalMinor, denominator: incomeTotalMinor };
}
