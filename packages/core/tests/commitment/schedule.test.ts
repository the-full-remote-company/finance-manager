import { describe, expect, it } from "vitest";
import { amountInForce, dueMonthsInRange, isDueMonth } from "../../src/commitment/schedule.js";

describe("isDueMonth", () => {
  it("every active month is due for monthly", () => {
    expect(isDueMonth(100, "monthly", null)).toBe(true);
  });

  it("is due exactly every period from the anchor for a periodic rhythm", () => {
    // anchor 24312 (2026-01), quarterly: due Jan, Apr, Jul, Oct.
    expect(isDueMonth(24312, "quarterly", 24312)).toBe(true);
    expect(isDueMonth(24313, "quarterly", 24312)).toBe(false);
    expect(isDueMonth(24315, "quarterly", 24312)).toBe(true);
  });

  it("allows an anchor before the start date: negative k is legal (B3)", () => {
    // anchor 24300 (2025-01), yearly: 24300, 24312, 24324, ... and also
    // 24288 (2024-01) going backward — the same rule applied with negative k.
    expect(isDueMonth(24288, "yearly", 24300)).toBe(true);
    expect(isDueMonth(24312, "yearly", 24300)).toBe(true);
  });

  it("a one-off is due in exactly its anchor month", () => {
    expect(isDueMonth(24312, "one_off", 24312)).toBe(true);
    expect(isDueMonth(24313, "one_off", 24312)).toBe(false);
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

  it("yields no due month before the first occurrence on or after the start month", () => {
    // Anchor 24300 (2025-01) yearly, but the commitment only starts 24312
    // (2026-01) — the edge case "start date falls after its anchor month".
    expect(dueMonthsInRange(24300, 24324, "yearly", 24300, 24312, null)).toEqual([24312, 24324]);
  });
});

describe("amountInForce", () => {
  it("picks the greatest effective month at or before the target", () => {
    const amounts = [{ effectiveMonth: 24312 }, { effectiveMonth: 24318 }];
    expect(amountInForce(amounts, 24315)).toEqual({ effectiveMonth: 24312 });
    expect(amountInForce(amounts, 24320)).toEqual({ effectiveMonth: 24318 });
  });

  it("returns null when every amount is in the future", () => {
    const amounts = [{ effectiveMonth: 24318 }];
    expect(amountInForce(amounts, 24312)).toBeNull();
  });
});
