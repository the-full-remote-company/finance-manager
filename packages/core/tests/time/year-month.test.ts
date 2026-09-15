import { describe, expect, it } from "vitest";
import {
  addMonths,
  compareMonths,
  formatMonth,
  monthOfIsoDate,
  parseMonth,
  toYearMonth,
  yearMonth,
} from "../../src/time/year-month.js";

/**
 * research B1: a YearMonth is the single integer `year * 12 + (month - 1)`.
 * Every projection comparison is an integer comparison on this index, which
 * removes every timezone and month-length question from the domain.
 *
 * Verified against the VQ-1 probe, which computed the same indices in
 * PostgreSQL: 1999-12 -> 23999, 2026-01 -> 24312, 2026-03 -> 24314.
 */
describe("YearMonth", () => {
  it("indexes a month as year * 12 + (month - 1)", () => {
    expect(yearMonth(2026, 1)).toBe(24_312);
    expect(yearMonth(2026, 3)).toBe(24_314);
    expect(yearMonth(1999, 12)).toBe(23_999);
  });

  it("agrees with the generated column verified in PostgreSQL 17 (VQ-1)", () => {
    // The probe inserted these three dates and read back these three indices.
    expect(monthOfIsoDate("2026-01-01")).toBe(24_312);
    expect(monthOfIsoDate("2026-03-15")).toBe(24_314);
    expect(monthOfIsoDate("1999-12-31")).toBe(23_999);
    expect(monthOfIsoDate("2026-12-31")).toBe(24_323);
  });

  it("round-trips through the YYYY-MM wire format", () => {
    expect(parseMonth("2026-01")).toBe(24_312);
    expect(toYearMonth(24_312)).toEqual({ year: 2026, month: 1 });
    expect(toYearMonth(parseMonth("2026-12"))).toEqual({ year: 2026, month: 12 });
  });

  it("crosses a year boundary by plain integer arithmetic", () => {
    const december = yearMonth(2026, 12);
    expect(toYearMonth(addMonths(december, 1))).toEqual({ year: 2027, month: 1 });
    expect(toYearMonth(addMonths(december, 13))).toEqual({ year: 2028, month: 1 });
    expect(toYearMonth(addMonths(yearMonth(2026, 1), -1))).toEqual({ year: 2025, month: 12 });
  });

  it("orders months", () => {
    expect(compareMonths(yearMonth(2026, 1), yearMonth(2026, 2))).toBeLessThan(0);
    expect(compareMonths(yearMonth(2026, 2), yearMonth(2026, 1))).toBeGreaterThan(0);
    expect(compareMonths(yearMonth(2026, 1), yearMonth(2026, 1))).toBe(0);
  });

  it("reduces a day-precise date to its month, never prorating (FR-026a)", () => {
    // A date anywhere in a month yields that whole month.
    expect(monthOfIsoDate("2026-03-01")).toBe(monthOfIsoDate("2026-03-31"));
  });

  it("rejects a month outside 1..12", () => {
    expect(() => yearMonth(2026, 0)).toThrow(/month/i);
    expect(() => yearMonth(2026, 13)).toThrow(/month/i);
    expect(() => parseMonth("2026-00")).toThrow(/YYYY-MM/);
    expect(() => parseMonth("2026-13")).toThrow(/YYYY-MM/);
  });

  it("rejects a malformed month or date string", () => {
    expect(() => parseMonth("2026-1")).toThrow(/YYYY-MM/);
    expect(() => parseMonth("26-01")).toThrow(/YYYY-MM/);
    expect(() => parseMonth("")).toThrow(/YYYY-MM/);
    expect(() => monthOfIsoDate("2026-03")).toThrow(/YYYY-MM-DD/);
    expect(() => monthOfIsoDate("15.03.2026")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a date that does not exist, rather than rolling it over", () => {
    // new Date("2026-02-30") silently becomes 2 March. The domain must not.
    expect(() => monthOfIsoDate("2026-02-30")).toThrow(/not a real date/i);
    expect(() => monthOfIsoDate("2026-13-01")).toThrow(/YYYY-MM-DD/);
  });

  it("accepts 29 February in a leap year and rejects it otherwise", () => {
    expect(monthOfIsoDate("2028-02-29")).toBe(yearMonth(2028, 2));
    expect(() => monthOfIsoDate("2026-02-29")).toThrow(/not a real date/i);
  });

  it("formats an index back to the wire format, zero-padded", () => {
    expect(formatMonth(yearMonth(2026, 1))).toBe("2026-01");
    expect(formatMonth(yearMonth(2026, 12))).toBe("2026-12");
    expect(formatMonth(parseMonth("2026-03"))).toBe("2026-03");
  });

  it("round-trips every month of a year through format and parse", () => {
    for (let month = 1; month <= 12; month += 1) {
      const index = yearMonth(2026, month);
      expect(parseMonth(formatMonth(index))).toBe(index);
    }
  });

  it("rejects a non-integer year, index or month offset", () => {
    expect(() => yearMonth(2026.5, 1)).toThrow(/year/i);
    expect(() => toYearMonth(1.5)).toThrow(/integer/i);
    expect(() => addMonths(24_312, 1.5)).toThrow(/integer/i);
  });
});
