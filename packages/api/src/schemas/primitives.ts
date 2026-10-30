import { monthOfIsoDate, parseMonth } from "@finance/core";
import { z } from "zod";

/**
 * The wire conventions from contracts/README.md.
 *
 * These are the trust boundary. "All input validated at the trust boundary
 * with a schema; validated types, not raw request objects, cross into
 * packages/core" — so every schema here parses into the domain's own
 * representation rather than handing on a string.
 */

/**
 * Money is a decimal string of minor units: `{ "minor": "95000", "currency": "EUR" }`.
 *
 * A JSON number cannot represent bigint safely, and superjson would make the
 * generated OpenAPI document TypeScript-only, which defeats the purpose
 * Article VI states for generating it.
 *
 * Parsed to bigint here, before anything crosses into packages/core.
 */
export const moneySchema = z
  .object({
    minor: z
      .string()
      .regex(/^\d+$/, "minor units must be a string of digits: never a JSON number, never a float"),
    currency: z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 alphabetic code"),
  })
  .transform((value) => ({ minor: BigInt(value.minor), currency: value.currency }));

/** A month is `YYYY-MM` on the wire and an integer index inside the domain. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "a month must be formatted YYYY-MM")
  .transform((value) => parseMonth(value));

/**
 * A date is `YYYY-MM-DD`. Day precision is preserved on the wire because the
 * notice deadline is only meaningful as a date; every projection comparison
 * reduces it to a month.
 *
 * Validated through the domain's own parser so that "2026-02-30" is rejected
 * here exactly as it would be there, rather than accepted and rolled over.
 */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date must be formatted YYYY-MM-DD")
  .refine((value) => {
    try {
      monthOfIsoDate(value);
      return true;
    } catch {
      return false;
    }
  }, "not a real date");

/** FR-015: defaults to 100, accepts 0 through 100. */
export const sharePercentSchema = z.number().int().min(0).max(100).optional().default(100);

/**
 * A percentage of income is an exact rational or null.
 *
 * Strings for the same reason money is a string, and unrounded because the
 * server does not round it — `Intl.NumberFormat` in the client does, per
 * Article II and FR-033.
 */
export const percentageSchema = z
  .object({
    numerator: z.string().regex(/^-?\d+$/),
    denominator: z.string().regex(/^\d+$/),
  })
  .nullable();

/** A response money value: bigint back out to its decimal string. */
export const moneyOut = (value: {
  minor: bigint;
  currency: string;
}): { minor: string; currency: string } => ({
  minor: value.minor.toString(),
  currency: value.currency,
});

export type MoneyInput = z.infer<typeof moneySchema>;
export type PercentageOutput = z.infer<typeof percentageSchema>;
