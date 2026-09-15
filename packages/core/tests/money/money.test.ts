import { describe, expect, it } from "vitest";
import {
  addMoney,
  assertChargeAmount,
  money,
  subtractMoney,
  sumMoney,
} from "../../src/money/money.js";

/**
 * Article II: money is integer minor units with an explicit ISO 4217 currency.
 * "A bare number is not an amount." Floating-point MUST NOT appear in any
 * monetary field, DTO or intermediate calculation.
 *
 * Money is SIGNED. FR-020's rejection of negative amounts applies to amounts a
 * user enters (a charge), and is enforced by assertChargeAmount at the trust
 * boundary. It is deliberately not a property of the type, because
 * dashboard.month returns `remaining = income - combined`, which the contract
 * states may be negative and calls "the one signed figure in the payload".
 */
describe("money", () => {
  it("carries minor units as bigint and an explicit currency", () => {
    const amount = money(95_000n, "EUR");

    expect(amount.minor).toBe(95_000n);
    expect(amount.currency).toBe("EUR");
  });

  it("accepts zero, so a paused contract needs no deletion", () => {
    expect(money(0n, "EUR").minor).toBe(0n);
  });

  it("accepts a negative amount, because `remaining` may be negative", () => {
    expect(money(-1_250n, "EUR").minor).toBe(-1_250n);
  });

  it("rejects a JavaScript number, which cannot carry minor units safely", () => {
    // @ts-expect-error a number is not a bigint: the type forbids it, and the
    // runtime guard exists because the trust boundary receives unvalidated JSON.
    expect(() => money(95_000, "EUR")).toThrow(/bigint/i);
  });

  it("rejects a currency that is not a three-letter ISO 4217 code", () => {
    expect(() => money(1n, "eur")).toThrow(/ISO 4217/i);
    expect(() => money(1n, "EURO")).toThrow(/ISO 4217/i);
    expect(() => money(1n, "")).toThrow(/ISO 4217/i);
  });

  describe("arithmetic", () => {
    it("adds and subtracts within one currency", () => {
      expect(addMoney(money(100n, "EUR"), money(23n, "EUR"))).toEqual(money(123n, "EUR"));
      expect(subtractMoney(money(100n, "EUR"), money(123n, "EUR"))).toEqual(money(-23n, "EUR"));
    });

    it("refuses to mix currencies", () => {
      expect(() => addMoney(money(1n, "EUR"), money(1n, "CHF"))).toThrow(/currency/i);
      expect(() => subtractMoney(money(1n, "EUR"), money(1n, "CHF"))).toThrow(/currency/i);
      expect(() => sumMoney([money(1n, "EUR"), money(1n, "CHF")])).toThrow(/currency/i);
    });

    it("sums a list, and requires a currency for the empty case", () => {
      expect(sumMoney([money(1n, "EUR"), money(2n, "EUR"), money(3n, "EUR")])).toEqual(
        money(6n, "EUR"),
      );
      // An empty sum has no currency to infer, and a bare zero is not an amount.
      expect(sumMoney([], "EUR")).toEqual(money(0n, "EUR"));
      expect(() => sumMoney([])).toThrow(/currency/i);
    });

    it("rejects an expected currency that disagrees with the list", () => {
      // The caller stating EUR while holding CHF is a bug worth surfacing,
      // not a preference to silently honour.
      expect(() => sumMoney([money(1n, "CHF")], "EUR")).toThrow(/currency/i);
    });
  });

  describe("assertChargeAmount — FR-020", () => {
    it("accepts zero and positive charges", () => {
      expect(() => {
        assertChargeAmount(money(0n, "EUR"));
      }).not.toThrow();
      expect(() => {
        assertChargeAmount(money(95_000n, "EUR"));
      }).not.toThrow();
    });

    it("rejects a negative charge, since direction comes from income/expense, not sign", () => {
      expect(() => {
        assertChargeAmount(money(-1n, "EUR"));
      }).toThrow(/NEGATIVE_AMOUNT/);
    });
  });
});
