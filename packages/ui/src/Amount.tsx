import type { Money } from "@finance/core";

export interface AmountProps {
  /** The value to render. Never rounded before this point (Article II). */
  value: Money;
  /**
   * Literal money direction — income or expense. This is the only thing
   * `.amt--gain` / `.amt--loss` may encode (research.md Part C): a reserve
   * versus an ordinary expense, or a stale figure, is status, not direction,
   * and must use neither class nor `--color-gain` / `--color-loss` directly.
   */
  direction: "income" | "expense";
  /**
   * The direction spelled out for assistive technology, e.g. "Einnahme" or
   * "Ausgabe" — supplied by the caller from `useTranslations()`, never a
   * literal here, so this package stays free of user-facing strings.
   */
  directionLabel: string;
  /** Fixed at `"de-DE"` (FR-042: one locale). Overridable only for tests. */
  locale?: string;
}

/**
 * Renders a `Money` value, per FR-043: direction and sign must be conveyed by
 * more than colour.
 *
 * Two independent signals beyond `.amt--gain` / `.amt--loss`'s colour, both
 * mandatory:
 *
 *  1. `signDisplay: "exceptZero"` puts a textual "+" or "−" in the formatted
 *     string itself, in whatever locale-correct sign character the host's
 *     ICU data uses — never added by hand alongside a formatter that would
 *     add its own and double it.
 *  2. `directionLabel` is present for assistive technology even where the
 *     sign character alone might be missed or mis-announced.
 *
 * No floating-point value is computed here except at this exact display
 * boundary (Article II: `packages/core` never rounds; this is the one place
 * that does, per research.md's percentage-display resolution).
 */
export function Amount({ value, direction, directionLabel, locale = "de-DE" }: AmountProps) {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    signDisplay: "exceptZero",
  });

  // Always present for `style: "currency"`; the type is optional only
  // because other styles may omit it.
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const magnitude = Number(value.minor < 0n ? -value.minor : value.minor) / 10 ** digits;
  const signedMagnitude = direction === "expense" ? -magnitude : magnitude;

  const className = direction === "income" ? "amt amt--gain" : "amt amt--loss";

  return (
    <span className={className}>
      <span className="sr-only">{directionLabel} </span>
      {formatter.format(signedMagnitude)}
    </span>
  );
}
