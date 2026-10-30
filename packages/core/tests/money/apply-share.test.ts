import { describe, expect, it } from "vitest";
import { applyShare } from "../../src/money/apply-share.js";

/**
 * FR-039: round each commitment's share to whole minor units at the point the
 * share is applied. FR-039a: half-up, applied identically everywhere, so the
 * same commitment always yields the same amount.
 *
 * Article II requires rounding to be explicit at the point it occurs. This is
 * the only place in the repository where a share is rounded.
 */
describe("applyShare", () => {
  it("rounds an exact half minor unit upwards", () => {
    // The spec's worked example: 40,01 € at 50% reads 20,01 €.
    // 4001 * 0.5 = 2000.5 -> 2001.
    expect(applyShare(4_001n, 50)).toBe(2_001n);
  });

  it("is the identity at 100% and zero at 0%", () => {
    expect(applyShare(6_603n, 100)).toBe(6_603n);
    // FR: a share of 0 contributes nothing to transfers but the commitment
    // still counts in category totals.
    expect(applyShare(6_603n, 0)).toBe(0n);
  });

  it("rounds below a half downwards", () => {
    // 1000 * 33% = 330 exactly.
    expect(applyShare(1_000n, 33)).toBe(330n);
    // 1001 * 33% = 330.33 -> 330.
    expect(applyShare(1_001n, 33)).toBe(330n);
    // 1005 * 33% = 331.65 -> 332.
    expect(applyShare(1_005n, 33)).toBe(332n);
  });

  it("is deterministic: the same input always yields the same output", () => {
    const first = applyShare(4_001n, 50);
    for (let repeat = 0; repeat < 100; repeat += 1) {
      expect(applyShare(4_001n, 50)).toBe(first);
    }
  });

  it("never exceeds the full amount, and never goes below zero", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const share = applyShare(4_001n, percent);
      expect(share >= 0n).toBe(true);
      expect(share <= 4_001n).toBe(true);
    }
  });

  it("rejects a share outside 0..100 or a non-integer share (FR-015)", () => {
    expect(() => applyShare(100n, 101)).toThrow(/0.*100/);
    expect(() => applyShare(100n, -1)).toThrow(/0.*100/);
    expect(() => applyShare(100n, 12.5)).toThrow(/integer/i);
  });

  it("rejects a negative amount: a charge is never negative (FR-020)", () => {
    expect(() => applyShare(-1n, 50)).toThrow(/negative/i);
  });

  it("uses no floating-point intermediate", () => {
    // A float intermediate loses precision above 2^53. This amount is far
    // beyond it; a Number-based implementation cannot return this exactly.
    expect(applyShare(9_007_199_254_740_993n, 100)).toBe(9_007_199_254_740_993n);
    expect(applyShare(9_007_199_254_740_993n, 50)).toBe(4_503_599_627_370_497n);
  });
});
