/**
 * Rhythm and period length, per research Part B3.
 *
 * `one_off` is modelled as a distinct rhythm rather than a period of some
 * length: it has no period at all, is due in exactly its anchor month, and
 * — Story 4 scenario 7 — is never smoothed. A function needing a period
 * length is typed to exclude it, so that omission is a compile error at the
 * call site rather than a runtime branch to remember.
 */
export type Rhythm = "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_off";

export type PeriodicRhythm = Exclude<Rhythm, "one_off">;

const PERIOD_MONTHS: Readonly<Record<PeriodicRhythm, number>> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export function periodMonths(rhythm: PeriodicRhythm): number {
  return PERIOD_MONTHS[rhythm];
}

export function isPeriodic(rhythm: Rhythm): rhythm is PeriodicRhythm {
  return rhythm !== "one_off";
}
