import { describe, expect, it } from "vitest";
import { allocate } from "../../src/money/allocate.js";

/**
 * Article II: "allocation functions MUST prove that the parts sum exactly to
 * the whole" and MUST NOT lose or invent minor units.
 *
 * SC-002 requires this verified over at least one thousand generated
 * combinations, which is the property test at the bottom.
 */
describe("allocate", () => {
  it("distributes the remainder to the earliest parts first", () => {
    // The spec's worked example. 10 000 / 3 = 3 333 remainder 1.
    expect(allocate(10_000n, 3)).toEqual([3_334n, 3_333n, 3_333n]);
  });

  it("divides evenly when there is no remainder", () => {
    // 66,03 € quarterly, the spec's US4 independent test.
    expect(allocate(6_603n, 3)).toEqual([2_201n, 2_201n, 2_201n]);
    // 240,00 € quarterly, the clipped-period example.
    expect(allocate(24_000n, 3)).toEqual([8_000n, 8_000n, 8_000n]);
  });

  it("handles a remainder of two", () => {
    expect(allocate(10_001n, 3)).toEqual([3_334n, 3_334n, 3_333n]);
  });

  it("allocates zero across every part", () => {
    expect(allocate(0n, 12)).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it("returns the whole for a single part", () => {
    expect(allocate(7n, 1)).toEqual([7n]);
  });

  it("rejects a non-positive or non-integer part count", () => {
    expect(() => allocate(100n, 0)).toThrow(/parts/i);
    expect(() => allocate(100n, -3)).toThrow(/parts/i);
    expect(() => allocate(100n, 1.5)).toThrow(/parts/i);
  });

  it("rejects a negative total: a charge is never negative (FR-020)", () => {
    expect(() => allocate(-1n, 3)).toThrow(/negative/i);
  });

  it("sums to the whole with a spread of at most one minor unit, over 1000 cases", () => {
    // SC-002: "verified for at least one thousand generated amount and period
    // combinations". Deterministic seed so a failure is reproducible — a
    // property test that cannot be replayed is a flake, not a proof.
    let seed = 0x9e3779b9;
    const next = (bound: number): number => {
      // xorshift32, integer-only: no Math.random, so CI failures are exact.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed % bound;
    };

    const periods = [1, 3, 6, 12];
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      const total = BigInt(next(10_000_000));
      const parts = periods[next(periods.length)] ?? 1;

      const shares = allocate(total, parts);

      expect(shares).toHaveLength(parts);
      expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(total);

      const max = shares.reduce((a, b) => (a > b ? a : b));
      const min = shares.reduce((a, b) => (a < b ? a : b));
      expect(max - min <= 1n).toBe(true);
    }
  });
});
