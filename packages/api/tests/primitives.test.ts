import { describe, expect, it } from "vitest";
import {
  dateSchema,
  moneySchema,
  monthSchema,
  percentageSchema,
  sharePercentSchema,
} from "../src/schemas/primitives.js";

/**
 * contracts/README.md wire conventions. These exist so a Swift client can
 * consume the OpenAPI document without a TypeScript-specific decoder, and so
 * that validated types — never raw request objects — cross into packages/core.
 */
describe("wire primitives", () => {
  describe("money", () => {
    it("parses a decimal string of minor units into bigint", () => {
      const parsed = moneySchema.parse({ minor: "95000", currency: "EUR" });
      expect(parsed).toEqual({ minor: 95_000n, currency: "EUR" });
      expect(typeof parsed.minor).toBe("bigint");
    });

    it("rejects a JSON number, which cannot carry minor units safely", () => {
      // The entire reason money is a string on the wire: JSON numbers are
      // doubles, and superjson would make the document TypeScript-only.
      expect(() => moneySchema.parse({ minor: 95000, currency: "EUR" })).toThrow();
    });

    it("rejects a decimal point: minor units are whole", () => {
      expect(() => moneySchema.parse({ minor: "950.00", currency: "EUR" })).toThrow();
    });

    it("rejects a negative string here, since the wire carries charges", () => {
      expect(() => moneySchema.parse({ minor: "-1", currency: "EUR" })).toThrow();
    });

    it("preserves precision beyond 2^53, which a number could not", () => {
      const parsed = moneySchema.parse({ minor: "9007199254740993", currency: "EUR" });
      expect(parsed.minor).toBe(9_007_199_254_740_993n);
    });

    it("requires an ISO 4217 currency", () => {
      expect(() => moneySchema.parse({ minor: "1", currency: "eur" })).toThrow();
      expect(() => moneySchema.parse({ minor: "1", currency: "EURO" })).toThrow();
    });
  });

  describe("month", () => {
    it("accepts YYYY-MM and yields the integer index used by the domain", () => {
      expect(monthSchema.parse("2026-01")).toBe(24_312);
      expect(monthSchema.parse("2026-03")).toBe(24_314);
    });

    it("rejects anything that is not YYYY-MM", () => {
      expect(() => monthSchema.parse("2026-1")).toThrow();
      expect(() => monthSchema.parse("2026-13")).toThrow();
      expect(() => monthSchema.parse("2026-00")).toThrow();
      expect(() => monthSchema.parse("03/2026")).toThrow();
    });
  });

  describe("date", () => {
    it("keeps day precision on the wire, because a notice deadline needs it", () => {
      expect(dateSchema.parse("2026-03-15")).toBe("2026-03-15");
    });

    it("rejects a date that does not exist rather than rolling it over", () => {
      expect(() => dateSchema.parse("2026-02-30")).toThrow();
      expect(() => dateSchema.parse("2026-13-01")).toThrow();
    });
  });

  describe("share percent", () => {
    it("accepts 0 through 100 and defaults to 100 (FR-015)", () => {
      expect(sharePercentSchema.parse(0)).toBe(0);
      expect(sharePercentSchema.parse(100)).toBe(100);
      expect(sharePercentSchema.parse(undefined)).toBe(100);
    });

    it("rejects out-of-range and fractional shares", () => {
      expect(() => sharePercentSchema.parse(101)).toThrow();
      expect(() => sharePercentSchema.parse(-1)).toThrow();
      expect(() => sharePercentSchema.parse(12.5)).toThrow();
    });
  });

  describe("percentage of income", () => {
    it("serialises an exact rational as strings", () => {
      expect(percentageSchema.parse({ numerator: "24000", denominator: "96000" })).toEqual({
        numerator: "24000",
        denominator: "96000",
      });
    });

    it("accepts null, which is how zero income is reported (FR-033)", () => {
      expect(percentageSchema.parse(null)).toBeNull();
    });
  });
});
