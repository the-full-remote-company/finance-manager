import { describe, expect, it } from "vitest";
import { smoothedShareForMonth } from "../../src/projection/smoothing.js";

describe("smoothedShareForMonth", () => {
  it("splits evenly when the charge divides exactly by the period", () => {
    // The spec's worked example: quarterly 66,03 € anchored to January.
    // 6603 / 3 = 2201 exactly.
    const anchor = 24312; // 2026-01
    expect(smoothedShareForMonth(24312, anchor, 3, 6603n)).toBe(2201n);
    expect(smoothedShareForMonth(24313, anchor, 3, 6603n)).toBe(2201n);
    expect(smoothedShareForMonth(24314, anchor, 3, 6603n)).toBe(2201n);
  });

  it("gives the remainder to the earliest month(s) when it doesn't divide exactly", () => {
    // 100,00 € quarterly: 10000 / 3 = 3333 remainder 1 -> Jan 3334, Feb 3333, Mar 3333.
    const anchor = 24312;
    expect(smoothedShareForMonth(24312, anchor, 3, 10000n)).toBe(3334n);
    expect(smoothedShareForMonth(24313, anchor, 3, 10000n)).toBe(3333n);
    expect(smoothedShareForMonth(24314, anchor, 3, 10000n)).toBe(3333n);
  });

  it("the spec's partially-covered-period worked example: 240,00 € quarterly, anchored January, ending February", () => {
    // January and February each show 80,00 €; March (24314) is never asked
    // for here because the commitment is inactive then — the caller simply
    // never calls this for an inactive month, which is how "March omitted"
    // is expressed, not a parameter to this function.
    const anchor = 24312;
    expect(smoothedShareForMonth(24312, anchor, 3, 24000n)).toBe(8000n);
    expect(smoothedShareForMonth(24313, anchor, 3, 24000n)).toBe(8000n);
    // The cash view, by contrast, shows the full 240,00 € in January alone
    // (asserted in dashboard/aggregate.test.ts, which owns cash-vs-smoothed
    // integration) — this module only owns the per-month split itself.
  });

  it("a month before the anchor still resolves within its own earlier period", () => {
    // Dec 2025 (24311), anchor Jan 2026 (24312), quarterly: belongs to the
    // Oct-Dec 2025 period, whose start is 24309.
    expect(smoothedShareForMonth(24311, 24312, 3, 9000n)).toBe(3000n);
  });

  it("is the identity for a monthly (period 1) rhythm", () => {
    expect(smoothedShareForMonth(24312, 0, 1, 12345n)).toBe(12345n);
  });
});
