/**
 * The amount-history lookup for a commitment, per research.md Part B6.
 * Due-month and rhythm arithmetic moved to `../projection/` (US4): those are
 * about the projection, not a commitment's amount history, which is the one
 * thing left here.
 */

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
