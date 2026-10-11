import { describe, expect, it } from "vitest";
import { periodEnd, periodStart } from "../../src/projection/period-window.js";

describe("periodStart", () => {
  it("is the month itself when it already is the anchor-aligned boundary", () => {
    // anchor 24312 (2026-01), quarterly (period 3): Jan is its own boundary.
    expect(periodStart(24312, 24312, 3)).toBe(24312);
  });

  it("finds the boundary at or before the month, within the period", () => {
    // Feb and Mar 2026 both belong to the Jan-Mar period.
    expect(periodStart(24313, 24312, 3)).toBe(24312);
    expect(periodStart(24314, 24312, 3)).toBe(24312);
    // Apr 2026 starts the next period.
    expect(periodStart(24315, 24312, 3)).toBe(24315);
  });

  it("uses a true floor, not truncation toward zero, for a month before the anchor (research B4)", () => {
    // anchor 24312 (2026-01), quarterly. Dec 2025 (24311) is one month before
    // the anchor: (24311 - 24312) / 3 = -1/3, which truncates to 0 but
    // floors to -1 — the explicit case this function exists to get right.
    // The correct period is Oct-Dec 2025, i.e. periodStart = 24312 - 3 = 24309.
    expect(periodStart(24311, 24312, 3)).toBe(24309);
    // The whole of that period maps to the same boundary.
    expect(periodStart(24309, 24312, 3)).toBe(24309);
    expect(periodStart(24310, 24312, 3)).toBe(24309);
  });

  it("is the identity for a monthly (period 1) rhythm, regardless of the anchor value", () => {
    expect(periodStart(24312, 0, 1)).toBe(24312);
    expect(periodStart(24312, 99999, 1)).toBe(24312);
  });
});

describe("periodEnd", () => {
  it("is period - 1 months after the start", () => {
    expect(periodEnd(24312, 3)).toBe(24314);
    expect(periodEnd(24312, 1)).toBe(24312);
    expect(periodEnd(24312, 12)).toBe(24323);
  });
});
