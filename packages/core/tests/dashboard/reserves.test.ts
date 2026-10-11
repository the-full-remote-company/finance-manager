import { describe, expect, it } from "vitest";
import { aggregateMonth, type AggregateCommitment } from "../../src/dashboard/aggregate.js";
import { parseMonth } from "../../src/time/year-month.js";

/**
 * User Story 5 (T114): a reserve commitment contributes to `reservesTotal`
 * and never to `expenseTotal` or an expense category total (FR-032); a
 * category holding both kinds appears in both lists with the matching
 * subset of lines (Story 5 scenario 2); `expenseTotal + reservesTotal ===
 * combinedTotal === the sum of all outgoing commitments`, asserted rather
 * than merely intended (Story 5 scenario 3).
 *
 * The aggregation under test already exists (T093/T116 landed together in
 * User Story 3 — reserves were part of the payload shape from the start);
 * this file is the dedicated, independent-test-level coverage the task list
 * asks for.
 */

const JAN_2026 = parseMonth("2026-01");

function commitment(overrides: Partial<AggregateCommitment> = {}): AggregateCommitment {
  return {
    id: "c1",
    name: "Posten",
    direction: "expense",
    kind: "expense",
    categoryId: "cat",
    categoryName: "Kategorie",
    rhythm: "monthly",
    anchorMonth: null,
    startMonth: parseMonth("2025-01"),
    endMonth: null,
    ...overrides,
  };
}

describe("reserves (User Story 5)", () => {
  it("a reserve contributes to reservesTotal, never to expenseTotal or an expense category total (FR-032)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" }),
        commitment({
          id: "etf",
          name: "ETF-Sparplan",
          kind: "reserve",
          categoryId: "savings",
          categoryName: "Sparen",
        }),
      ],
      amounts: [
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 95000n,
          currency: "EUR",
        },
        {
          commitmentId: "etf",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 20000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    expect(result.expenseCategories.some((c) => c.categoryId === "savings")).toBe(false);
    expect(result.expenseTotal).toEqual({ minor: 95000n, currency: "EUR" });
    expect(result.reserveCategories).toHaveLength(1);
    expect(result.reserveCategories[0]?.categoryId).toBe("savings");
    expect(result.reservesTotal).toEqual({ minor: 20000n, currency: "EUR" });
  });

  it("a category holding both kinds appears in both lists with the matching subset of lines (Story 5 scenario 2)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({ id: "spending", categoryId: "mixed", categoryName: "Gemischt" }),
        commitment({
          id: "saving",
          name: "Rücklage",
          kind: "reserve",
          categoryId: "mixed",
          categoryName: "Gemischt",
        }),
      ],
      amounts: [
        {
          commitmentId: "spending",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 1000n,
          currency: "EUR",
        },
        {
          commitmentId: "saving",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 2000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    const expenseSide = result.expenseCategories.find((c) => c.categoryId === "mixed");
    const reserveSide = result.reserveCategories.find((c) => c.categoryId === "mixed");
    expect(expenseSide?.lines.map((l) => l.commitmentId)).toEqual(["spending"]);
    expect(reserveSide?.lines.map((l) => l.commitmentId)).toEqual(["saving"]);
  });

  it("expenseTotal + reservesTotal === combinedTotal === the sum of every outgoing commitment (Story 5 scenario 3)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" }),
        commitment({ id: "power", name: "Strom", categoryId: "housing", categoryName: "Wohnen" }),
        commitment({
          id: "etf",
          name: "ETF-Sparplan",
          kind: "reserve",
          categoryId: "savings",
          categoryName: "Sparen",
        }),
        commitment({
          id: "loan",
          name: "Tilgung",
          kind: "reserve",
          categoryId: "loan",
          categoryName: "Kredit",
        }),
      ],
      amounts: [
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 95000n,
          currency: "EUR",
        },
        {
          commitmentId: "power",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 8000n,
          currency: "EUR",
        },
        {
          commitmentId: "etf",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 20000n,
          currency: "EUR",
        },
        {
          commitmentId: "loan",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 50000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    const sumOfEveryOutgoing = 95000n + 8000n + 20000n + 50000n;
    expect(result.combinedTotal.minor).toBe(sumOfEveryOutgoing);
    expect(result.expenseTotal.minor + result.reservesTotal.minor).toBe(result.combinedTotal.minor);
    expect(result.combinedTotal).toEqual({ minor: sumOfEveryOutgoing, currency: "EUR" });
  });
});
