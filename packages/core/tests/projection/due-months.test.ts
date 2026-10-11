import { describe, expect, it } from "vitest";
import { dueMonthsInRange, isDueMonth } from "../../src/projection/due-months.js";

describe("isDueMonth", () => {
  it("every active month is due for monthly (period length 1)", () => {
    expect(isDueMonth(100, "monthly", null)).toBe(true);
  });

  it("is due exactly every period from the anchor for a periodic rhythm", () => {
    // anchor 24312 (2026-01), quarterly (period 3): due Jan, Apr, Jul, Oct.
    expect(isDueMonth(24312, "quarterly", 24312)).toBe(true);
    expect(isDueMonth(24313, "quarterly", 24312)).toBe(false);
    expect(isDueMonth(24315, "quarterly", 24312)).toBe(true);
  });

  it("is due exactly every period for half_yearly (period 6) and yearly (period 12)", () => {
    expect(isDueMonth(24312, "half_yearly", 24312)).toBe(true);
    expect(isDueMonth(24317, "half_yearly", 24312)).toBe(false);
    expect(isDueMonth(24318, "half_yearly", 24312)).toBe(true);

    expect(isDueMonth(24312, "yearly", 24312)).toBe(true);
    expect(isDueMonth(24323, "yearly", 24312)).toBe(false);
    expect(isDueMonth(24324, "yearly", 24312)).toBe(true);
  });

  it("allows an anchor before the start date: negative k is legal (B3)", () => {
    // anchor 24300 (2025-01), yearly: 24300, 24312, 24324, ... and also
    // 24288 (2024-01) going backward — the same rule applied with negative k.
    expect(isDueMonth(24288, "yearly", 24300)).toBe(true);
    expect(isDueMonth(24312, "yearly", 24300)).toBe(true);
  });

  it("a one-off is due in exactly its anchor month, nothing else", () => {
    expect(isDueMonth(24312, "one_off", 24312)).toBe(true);
    expect(isDueMonth(24313, "one_off", 24312)).toBe(false);
    expect(isDueMonth(24311, "one_off", 24312)).toBe(false);
  });

  it("has no due month when a non-monthly rhythm has no anchor", () => {
    expect(isDueMonth(24312, "quarterly", null)).toBe(false);
  });
});

describe("dueMonthsInRange", () => {
  it("restricts due months to the active window", () => {
    // Active 24312..24314 (Jan-Mar 2026), monthly.
    expect(dueMonthsInRange(24310, 24316, "monthly", null, 24312, 24314)).toEqual([
      24312, 24313, 24314,
    ]);
  });

  it("yields no due month before the first occurrence on or after the start month (FR-029 edge case)", () => {
    // Anchor 24300 (2025-01) yearly, but the commitment only starts 24312
    // (2026-01) — the anchor predates the start date, and the first due
    // month actually reached is the first occurrence on or after the start.
    expect(dueMonthsInRange(24300, 24324, "yearly", 24300, 24312, null)).toEqual([24312, 24324]);
  });

  it("every month is due for monthly, restricted only by activity", () => {
    expect(dueMonthsInRange(24312, 24315, "monthly", null, 24312, 24315)).toEqual([
      24312, 24313, 24314, 24315,
    ]);
  });
});
