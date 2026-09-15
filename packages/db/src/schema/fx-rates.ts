import { sql } from "drizzle-orm";
import { bigint, char, date, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Article II: "An FX rate table with effective dates MUST exist from the first
 * migration that introduces money, even while the product displays a single
 * currency."
 *
 * Nothing reads this table in this release — no conversion, no rate handling,
 * no multi-currency display (spec Assumptions). It exists because retrofitting
 * currency into a schema that assumed one is a migration across every table
 * that touches an amount, and because the article says so.
 *
 * Not tenant-scoped: a rate is a fact about the world, not about a household.
 * Its exemption from RLS is asserted by the policy-coverage test.
 *
 * The rate is stored as an integer numerator over an integer denominator, not
 * a float: Article II forbids floating point in any monetary calculation, and
 * a rate multiplied into an amount is exactly that.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
    /** rate = numerator / denominator, both integers. */
    rateNumerator: bigint("rate_numerator", { mode: "bigint" }).notNull(),
    rateDenominator: bigint("rate_denominator", { mode: "bigint" }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("fx_rates_pair_effective_key").on(
      table.baseCurrency,
      table.quoteCurrency,
      table.effectiveFrom,
    ),
  ],
);
