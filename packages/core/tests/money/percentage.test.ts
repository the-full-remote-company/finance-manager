import { describe, expect, it } from "vitest";
import { percentOfIncome } from "../../src/money/percentage.js";

/**
 * FR-033: display each category total as a percentage of that month's income,
 * and suppress the percentage when income is zero.
 *
 * Article II keeps the last rounding decision in the presentation layer, so the
 * domain returns an exact rational and never a rounded number. Intl.NumberFormat
 * in the client performs the only rounding.
 */
describe("percentOfIncome", () => {
  it("returns an exact rational, unrounded", () => {
    expect(percentOfIncome(24_000n, 96_000n)).toEqual({ numerator: 24_000n, denominator: 96_000n });
  });

  it("does not reduce the fraction, so the figures stay traceable to the payload", () => {
    // 24000/96000 is exactly 25%, but reducing it would discard the category
    // total and the income the client may want to show alongside it.
    const percentage = percentOfIncome(24_000n, 96_000n);
    expect(percentage).not.toBeNull();
    expect(percentage?.numerator).toBe(24_000n);
    expect(percentage?.denominator).toBe(96_000n);
  });

  it("returns null when income is zero — suppressed, not zero, not an error", () => {
    expect(percentOfIncome(24_000n, 0n)).toBeNull();
  });

  it("returns a rational for a zero category total against non-zero income", () => {
    expect(percentOfIncome(0n, 96_000n)).toEqual({ numerator: 0n, denominator: 96_000n });
  });

  it("keeps a third exactly, where a rounded percentage would not", () => {
    // 1/3 has no exact decimal representation. The domain must not decide how
    // many digits the client shows.
    expect(percentOfIncome(1n, 3n)).toEqual({ numerator: 1n, denominator: 3n });
  });

  it("rejects a negative income, which is not representable", () => {
    expect(() => percentOfIncome(1n, -1n)).toThrow(/negative/i);
  });
});
