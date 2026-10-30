import { describe, expect, it } from "vitest";
import { isActiveInMonth } from "../../src/time/activity-window.js";
import { monthOfIsoDate } from "../../src/time/year-month.js";

describe("isActiveInMonth", () => {
  it("is active from the start month onward with no end", () => {
    expect(isActiveInMonth(100, 100, null)).toBe(true);
    expect(isActiveInMonth(150, 100, null)).toBe(true);
    expect(isActiveInMonth(99, 100, null)).toBe(false);
  });

  it("is inactive after the end month, inclusive at the boundary", () => {
    expect(isActiveInMonth(110, 100, 110)).toBe(true);
    expect(isActiveInMonth(111, 100, 110)).toBe(false);
  });

  it("a commitment starting mid-month is active for its whole start month at full amount, never prorated (FR-026, FR-026a)", () => {
    const startMonth = monthOfIsoDate("2026-03-15");
    expect(isActiveInMonth(startMonth, startMonth, null)).toBe(true);
    expect(isActiveInMonth(monthOfIsoDate("2026-02-28"), startMonth, null)).toBe(false);
  });

  it("a commitment ending mid-month is active for its whole end month, never prorated (FR-026, FR-026a)", () => {
    const startMonth = monthOfIsoDate("2026-01-01");
    const endMonth = monthOfIsoDate("2026-03-15");
    expect(isActiveInMonth(monthOfIsoDate("2026-03-31"), startMonth, endMonth)).toBe(true);
    expect(isActiveInMonth(monthOfIsoDate("2026-04-01"), startMonth, endMonth)).toBe(false);
  });
});
