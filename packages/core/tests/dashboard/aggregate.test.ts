import { describe, expect, it } from "vitest";
import { aggregateMonth, type AggregateCommitment } from "../../src/dashboard/aggregate.js";
import { parseMonth } from "../../src/time/year-month.js";

const JAN_2026 = parseMonth("2026-01");

function commitment(overrides: Partial<AggregateCommitment> = {}): AggregateCommitment {
  return {
    id: "c1",
    name: "Miete",
    direction: "expense",
    kind: "expense",
    categoryId: "cat-housing",
    categoryName: "Wohnen",
    rhythm: "monthly",
    anchorMonth: null,
    startMonth: parseMonth("2025-01"),
    endMonth: null,
    ...overrides,
  };
}

describe("aggregateMonth", () => {
  it("totals income with its own list (FR-034)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({
          id: "salary",
          name: "Gehalt",
          direction: "income",
          kind: "expense",
          categoryId: "cat-income",
          categoryName: "Gehalt",
        }),
      ],
      amounts: [
        {
          commitmentId: "salary",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 300000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    expect(result.income.total).toEqual({ minor: 300000n, currency: "EUR" });
    expect(result.income.lines).toEqual([
      {
        commitmentId: "salary",
        name: "Gehalt",
        categoryId: "cat-income",
        amount: { minor: 300000n, currency: "EUR" },
      },
    ]);
  });

  it("sums per-category expense totals and the overall expense total (FR-031)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" }),
        commitment({ id: "power", name: "Strom", categoryId: "housing", categoryName: "Wohnen" }),
        commitment({ id: "gym", name: "Fitness", categoryId: "leisure", categoryName: "Freizeit" }),
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
          commitmentId: "gym",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 3000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    const housing = result.expenseCategories.find((c) => c.categoryId === "housing");
    expect(housing?.total).toEqual({ minor: 103000n, currency: "EUR" });
    expect(housing?.lines).toHaveLength(2);
    expect(result.expenseTotal).toEqual({ minor: 106000n, currency: "EUR" });
  });

  it("computes remaining, which may be negative, and combinedTotal (FR-031)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({
          id: "salary",
          direction: "income",
          categoryId: "income",
          categoryName: "Gehalt",
        }),
        commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" }),
      ],
      amounts: [
        {
          commitmentId: "salary",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 50000n,
          currency: "EUR",
        },
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 95000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });

    expect(result.combinedTotal).toEqual({ minor: 95000n, currency: "EUR" });
    expect(result.remaining).toEqual({ minor: -45000n, currency: "EUR" });
  });

  it("gives percentOfIncome as an exact rational, null when income is zero (FR-033)", () => {
    const withIncome = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({
          id: "salary",
          direction: "income",
          categoryId: "income",
          categoryName: "Gehalt",
        }),
        commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" }),
      ],
      amounts: [
        {
          commitmentId: "salary",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 200000n,
          currency: "EUR",
        },
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 50000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });
    expect(withIncome.expenseCategories[0]?.percentOfIncome).toEqual({
      numerator: 50000n,
      denominator: 200000n,
    });

    const noIncome = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" })],
      amounts: [
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 50000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });
    expect(noIncome.expenseCategories[0]?.percentOfIncome).toBeNull();
  });

  it("excludes reserve commitments from expenseCategories/expenseTotal and reports them separately (FR-032)", () => {
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
    expect(result.reserveCategories[0]?.categoryId).toBe("savings");
    expect(result.reservesTotal).toEqual({ minor: 20000n, currency: "EUR" });
    expect(result.combinedTotal).toEqual({ minor: 115000n, currency: "EUR" });
  });

  it("a category with both an expense and a reserve commitment appears in both lists with the matching subset (FR-032, Story 5 scenario 2)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [
        commitment({ id: "spending", categoryId: "mixed", categoryName: "Gemischt" }),
        commitment({
          id: "saving",
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
    expect(expenseSide?.lines).toHaveLength(1);
    expect(expenseSide?.total).toEqual({ minor: 1000n, currency: "EUR" });
    expect(reserveSide?.lines).toHaveLength(1);
    expect(reserveSide?.total).toEqual({ minor: 2000n, currency: "EUR" });
  });

  it("omits a category with no active commitment in the month, uniformly across months (Story 3 scenario 5)", () => {
    const quarterly = commitment({
      id: "insurance",
      rhythm: "quarterly",
      anchorMonth: parseMonth("2026-01"),
      categoryId: "insurance",
      categoryName: "Versicherung",
    });
    const feb = parseMonth("2026-02");
    const result = aggregateMonth({
      month: feb,
      presentation: "cash",
      currency: "EUR",
      commitments: [quarterly],
      amounts: [
        {
          commitmentId: "insurance",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 30000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });
    expect(result.expenseCategories).toHaveLength(0);
  });

  it("applies an override for its month in place of the amount in force (FR-022/023)", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" })],
      amounts: [
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 95000n,
          currency: "EUR",
        },
      ],
      overrides: [{ commitmentId: "rent", month: JAN_2026, amountMinor: 99000n, currency: "EUR" }],
    });
    expect(result.expenseCategories[0]?.total).toEqual({ minor: 99000n, currency: "EUR" });
  });

  it("a commitment active but not due in the month contributes nothing to the cash view (edge case)", () => {
    const quarterly = commitment({
      id: "insurance",
      rhythm: "quarterly",
      anchorMonth: parseMonth("2026-01"),
      categoryId: "insurance",
      categoryName: "Versicherung",
    });
    const feb = parseMonth("2026-02");
    const result = aggregateMonth({
      month: feb,
      presentation: "cash",
      currency: "EUR",
      commitments: [quarterly],
      amounts: [
        {
          commitmentId: "insurance",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 30000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });
    expect(result.expenseTotal).toEqual({ minor: 0n, currency: "EUR" });
  });

  it("marks a due cash line isDue true", () => {
    const result = aggregateMonth({
      month: JAN_2026,
      presentation: "cash",
      currency: "EUR",
      commitments: [commitment({ id: "rent", categoryId: "housing", categoryName: "Wohnen" })],
      amounts: [
        {
          commitmentId: "rent",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 95000n,
          currency: "EUR",
        },
      ],
      overrides: [],
    });
    expect(result.expenseCategories[0]?.lines[0]?.isDue).toBe(true);
  });

  describe("presentation (T111, User Story 4)", () => {
    const quarterly = commitment({
      id: "insurance",
      name: "Versicherung",
      rhythm: "quarterly",
      anchorMonth: parseMonth("2026-01"),
      categoryId: "insurance",
      categoryName: "Versicherung",
    });
    const quarterlyAmounts = [
      {
        commitmentId: "insurance",
        effectiveMonth: parseMonth("2025-01"),
        amountMinor: 6603n,
        currency: "EUR",
      },
    ];

    it("cash: the full charge appears only in the due month (spec's worked example)", () => {
      const jan = aggregateMonth({
        month: JAN_2026,
        presentation: "cash",
        currency: "EUR",
        commitments: [quarterly],
        amounts: quarterlyAmounts,
        overrides: [],
      });
      expect(jan.expenseTotal).toEqual({ minor: 6603n, currency: "EUR" });

      const feb = aggregateMonth({
        month: parseMonth("2026-02"),
        presentation: "cash",
        currency: "EUR",
        commitments: [quarterly],
        amounts: quarterlyAmounts,
        overrides: [],
      });
      expect(feb.expenseTotal).toEqual({ minor: 0n, currency: "EUR" });
    });

    it("smoothed: one third of the charge appears in every active month, including non-due ones (FR-028a)", () => {
      for (const month of ["2026-01", "2026-02", "2026-03"]) {
        const result = aggregateMonth({
          month: parseMonth(month),
          presentation: "smoothed",
          currency: "EUR",
          commitments: [quarterly],
          amounts: quarterlyAmounts,
          overrides: [],
        });
        expect(result.expenseTotal, month).toEqual({ minor: 2201n, currency: "EUR" });
      }
    });

    it("isDue is true only at the real due month, even in the smoothed view", () => {
      const jan = aggregateMonth({
        month: JAN_2026,
        presentation: "smoothed",
        currency: "EUR",
        commitments: [quarterly],
        amounts: quarterlyAmounts,
        overrides: [],
      });
      expect(jan.expenseCategories[0]?.lines[0]?.isDue).toBe(true);

      const feb = aggregateMonth({
        month: parseMonth("2026-02"),
        presentation: "smoothed",
        currency: "EUR",
        commitments: [quarterly],
        amounts: quarterlyAmounts,
        overrides: [],
      });
      expect(feb.expenseCategories[0]?.lines[0]?.isDue).toBe(false);
    });

    it("a one-off is never smoothed (Story 4 scenario 7): identical in both presentations", () => {
      const oneOff = commitment({
        id: "bonus-payout",
        rhythm: "one_off",
        anchorMonth: JAN_2026,
        categoryId: "oneoff",
        categoryName: "Einmalig",
      });
      const oneOffAmounts = [
        {
          commitmentId: "bonus-payout",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 12000n,
          currency: "EUR",
        },
      ];

      for (const presentation of ["cash", "smoothed"] as const) {
        const jan = aggregateMonth({
          month: JAN_2026,
          presentation,
          currency: "EUR",
          commitments: [oneOff],
          amounts: oneOffAmounts,
          overrides: [],
        });
        expect(jan.expenseTotal, presentation).toEqual({ minor: 12000n, currency: "EUR" });

        const feb = aggregateMonth({
          month: parseMonth("2026-02"),
          presentation,
          currency: "EUR",
          commitments: [oneOff],
          amounts: oneOffAmounts,
          overrides: [],
        });
        expect(feb.expenseTotal, presentation).toEqual({ minor: 0n, currency: "EUR" });
      }
    });

    it("the spec's partially-covered-period example: 240,00 € quarterly anchored January, ending February", () => {
      const endingEarly = commitment({
        id: "short-contract",
        rhythm: "quarterly",
        anchorMonth: JAN_2026,
        endMonth: parseMonth("2026-02"),
        categoryId: "housing",
        categoryName: "Wohnen",
      });
      const amounts = [
        {
          commitmentId: "short-contract",
          effectiveMonth: parseMonth("2025-01"),
          amountMinor: 24000n,
          currency: "EUR",
        },
      ];

      const smoothedJan = aggregateMonth({
        month: JAN_2026,
        presentation: "smoothed",
        currency: "EUR",
        commitments: [endingEarly],
        amounts,
        overrides: [],
      });
      expect(smoothedJan.expenseTotal).toEqual({ minor: 8000n, currency: "EUR" });

      const smoothedFeb = aggregateMonth({
        month: parseMonth("2026-02"),
        presentation: "smoothed",
        currency: "EUR",
        commitments: [endingEarly],
        amounts,
        overrides: [],
      });
      expect(smoothedFeb.expenseTotal).toEqual({ minor: 8000n, currency: "EUR" });

      // March: inactive (the contract ended in February), omitted entirely —
      // the smoothed total for this period (16000) is therefore less than
      // the charge (24000), per FR-028b.
      const smoothedMar = aggregateMonth({
        month: parseMonth("2026-03"),
        presentation: "smoothed",
        currency: "EUR",
        commitments: [endingEarly],
        amounts,
        overrides: [],
      });
      expect(smoothedMar.expenseTotal).toEqual({ minor: 0n, currency: "EUR" });

      // The cash view still shows the full 240,00 € in January.
      const cashJan = aggregateMonth({
        month: JAN_2026,
        presentation: "cash",
        currency: "EUR",
        commitments: [endingEarly],
        amounts,
        overrides: [],
      });
      expect(cashJan.expenseTotal).toEqual({ minor: 24000n, currency: "EUR" });
    });

    it("a commitment starting part-way through a period still gets a smoothed share, using its own start month's amount (edge case)", () => {
      // The commitment starts in February, inside a Jan-Mar quarterly
      // period anchored to January — there is no amount history before
      // February, so the period's "due amount" resolves at the start month.
      const startsLate = commitment({
        id: "late-start",
        rhythm: "quarterly",
        anchorMonth: JAN_2026,
        startMonth: parseMonth("2026-02"),
        categoryId: "housing",
        categoryName: "Wohnen",
      });
      const amounts = [
        {
          commitmentId: "late-start",
          effectiveMonth: parseMonth("2026-02"),
          amountMinor: 9000n,
          currency: "EUR",
        },
      ];

      const cashJan = aggregateMonth({
        month: JAN_2026,
        presentation: "cash",
        currency: "EUR",
        commitments: [startsLate],
        amounts,
        overrides: [],
      });
      // Inactive in January: nothing in the cash view for that period at all.
      expect(cashJan.expenseTotal).toEqual({ minor: 0n, currency: "EUR" });

      const smoothedFeb = aggregateMonth({
        month: parseMonth("2026-02"),
        presentation: "smoothed",
        currency: "EUR",
        commitments: [startsLate],
        amounts,
        overrides: [],
      });
      expect(smoothedFeb.expenseTotal).toEqual({ minor: 3000n, currency: "EUR" });
    });
  });
});
