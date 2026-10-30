import { describe, expect, it } from "vitest";
import { smoothedShareForMonth } from "../../src/projection/smoothing.js";

const PERIODS = [1, 3, 6, 12] as const;
const ANCHOR = 24312; // 2026-01, arbitrary

describe("smoothedShareForMonth exactness (SC-002, Story 4 scenario 4)", () => {
  it("the smoothed months of one fully covered period always sum to exactly the charge, over >=1000 combinations", () => {
    let combinations = 0;

    for (const period of PERIODS) {
      for (let amountMinor = 0; amountMinor < 1000; amountMinor += 1) {
        combinations += 1;
        const chargeMinor = BigInt(amountMinor);

        let total = 0n;
        for (let month = ANCHOR; month < ANCHOR + period; month += 1) {
          total += smoothedShareForMonth(month, ANCHOR, period, chargeMinor);
        }

        expect(total, `period=${String(period)} amount=${String(amountMinor)}`).toBe(chargeMinor);
      }
    }

    expect(combinations).toBeGreaterThanOrEqual(1000);
  });

  it("holds for larger, non-trivial amounts too, across every period length", () => {
    const amounts = [1n, 7n, 66_03n, 100_00n, 999_99n, 1_234_567n];
    for (const period of PERIODS) {
      for (const chargeMinor of amounts) {
        let total = 0n;
        for (let month = ANCHOR; month < ANCHOR + period; month += 1) {
          total += smoothedShareForMonth(month, ANCHOR, period, chargeMinor);
        }
        expect(total).toBe(chargeMinor);
      }
    }
  });
});
