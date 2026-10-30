import {
  aggregateMonth,
  formatMonth,
  monthOfIsoDate,
  type AggregateAmount,
  type AggregateCommitment,
  type AggregateOverride,
} from "@finance/core";
import { eq, schema } from "@finance/db";
import { z } from "zod";
import { appError, toTrpcError } from "../errors.js";
import { monthSchema, moneyOut, percentageSchema } from "../schemas/primitives.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `dashboard`, per contracts/procedures.md. No projection row is persisted or
 * cached in the database (research B9) — every call recomputes from the
 * workspace's commitment set.
 */

// The workspace's single currency, per the convention already established in
// `commitments.ts` and the `commitment_amounts` schema default. No currency
// field exists yet anywhere a user could change it.
const WORKSPACE_CURRENCY = "EUR";

/**
 * The 24-month rolling window: the trailing 12 months plus the current month
 * plus the next 11, relative to the server's current month (FR-025). Not
 * configurable; not stored.
 */
function horizonWindow(currentMonth: number): { firstMonth: number; lastMonth: number } {
  return { firstMonth: currentMonth - 12, lastMonth: currentMonth + 11 };
}

function currentMonthIndex(): number {
  return monthOfIsoDate(new Date().toISOString().slice(0, 10));
}

const moneyOutSchema = z.object({ minor: z.string(), currency: z.string() });

const lineOutput = z.object({
  commitmentId: z.string(),
  name: z.string(),
  amount: moneyOutSchema,
  isDue: z.boolean(),
});

const categoryOutput = z.object({
  categoryId: z.string(),
  name: z.string(),
  total: moneyOutSchema,
  percentOfIncome: percentageSchema,
  lines: z.array(lineOutput),
});

export const dashboardRouter = router({
  horizon: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/dashboard/horizon", tags: ["dashboard"] } })
    .input(z.void())
    .output(
      z.object({
        firstMonth: z.string(),
        lastMonth: z.string(),
        currentMonth: z.string(),
      }),
    )
    .query(() => {
      const currentMonth = currentMonthIndex();
      const { firstMonth, lastMonth } = horizonWindow(currentMonth);
      return {
        firstMonth: formatMonth(firstMonth),
        lastMonth: formatMonth(lastMonth),
        currentMonth: formatMonth(currentMonth),
      };
    }),

  month: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/dashboard/month", tags: ["dashboard"] } })
    .input(
      z.object({
        month: monthSchema,
        presentation: z.enum(["smoothed", "cash"]),
      }),
    )
    .output(
      z.object({
        month: z.string(),
        presentation: z.enum(["smoothed", "cash"]),
        currency: z.string(),
        income: z.object({
          total: moneyOutSchema,
          lines: z.array(
            z.object({
              commitmentId: z.string(),
              name: z.string(),
              categoryId: z.string(),
              amount: moneyOutSchema,
            }),
          ),
        }),
        expenseCategories: z.array(categoryOutput),
        expenseTotal: moneyOutSchema,
        reservesTotal: moneyOutSchema,
        reserveCategories: z.array(categoryOutput),
        combinedTotal: moneyOutSchema,
        remaining: moneyOutSchema,
        retrievedAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentMonth = currentMonthIndex();
      const { firstMonth, lastMonth } = horizonWindow(currentMonth);
      if (input.month < firstMonth || input.month > lastMonth) {
        throw toTrpcError(
          appError("MONTH_OUT_OF_HORIZON", {
            firstMonth: formatMonth(firstMonth),
            lastMonth: formatMonth(lastMonth),
          }),
        );
      }

      // The workspace's whole commitment set, one query — RLS already scopes
      // every row to the caller's workspace, so no explicit filter is added.
      const commitmentRows = await ctx.db
        .select({
          id: schema.commitments.id,
          name: schema.commitments.name,
          direction: schema.commitments.direction,
          kind: schema.commitments.kind,
          categoryId: schema.commitments.categoryId,
          categoryName: schema.categories.name,
          rhythm: schema.commitments.rhythm,
          anchorMonth: schema.commitments.anchorMonth,
          startMonth: schema.commitments.startMonth,
          endMonth: schema.commitments.endMonth,
        })
        .from(schema.commitments)
        .innerJoin(schema.categories, eq(schema.commitments.categoryId, schema.categories.id));

      const amountRows = await ctx.db
        .select({
          commitmentId: schema.commitmentAmounts.commitmentId,
          effectiveMonth: schema.commitmentAmounts.effectiveMonth,
          amountMinor: schema.commitmentAmounts.amountMinor,
          currency: schema.commitmentAmounts.currency,
        })
        .from(schema.commitmentAmounts);

      const overrideRows = await ctx.db
        .select({
          commitmentId: schema.amountOverrides.commitmentId,
          month: schema.amountOverrides.month,
          amountMinor: schema.amountOverrides.amountMinor,
          currency: schema.amountOverrides.currency,
        })
        .from(schema.amountOverrides)
        .where(eq(schema.amountOverrides.month, input.month));

      const commitments: AggregateCommitment[] = commitmentRows
        .filter((row) => row.startMonth !== null)
        .map((row) => ({
          id: row.id,
          name: row.name,
          direction: row.direction,
          kind: row.kind,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          rhythm: row.rhythm,
          anchorMonth: row.anchorMonth,
          startMonth: row.startMonth as number,
          endMonth: row.endMonth,
        }));

      const amounts: AggregateAmount[] = amountRows
        .filter((row) => row.effectiveMonth !== null)
        .map((row) => ({
          commitmentId: row.commitmentId,
          effectiveMonth: row.effectiveMonth as number,
          amountMinor: row.amountMinor,
          currency: row.currency,
        }));

      const overrides: AggregateOverride[] = overrideRows.map((row) => ({
        commitmentId: row.commitmentId,
        month: row.month,
        amountMinor: row.amountMinor,
        currency: row.currency,
      }));

      const result = aggregateMonth({
        month: input.month,
        presentation: input.presentation,
        currency: WORKSPACE_CURRENCY,
        commitments,
        amounts,
        overrides,
      });

      return {
        month: formatMonth(result.month),
        presentation: result.presentation,
        currency: result.currency,
        income: {
          total: moneyOut(result.income.total),
          lines: result.income.lines.map((line) => ({
            commitmentId: line.commitmentId,
            name: line.name,
            categoryId: line.categoryId,
            amount: moneyOut(line.amount),
          })),
        },
        expenseCategories: result.expenseCategories.map((category) => ({
          categoryId: category.categoryId,
          name: category.name,
          total: moneyOut(category.total),
          percentOfIncome: category.percentOfIncome
            ? {
                numerator: category.percentOfIncome.numerator.toString(),
                denominator: category.percentOfIncome.denominator.toString(),
              }
            : null,
          lines: category.lines.map((line) => ({
            commitmentId: line.commitmentId,
            name: line.name,
            amount: moneyOut(line.amount),
            isDue: line.isDue,
          })),
        })),
        expenseTotal: moneyOut(result.expenseTotal),
        reservesTotal: moneyOut(result.reservesTotal),
        reserveCategories: result.reserveCategories.map((category) => ({
          categoryId: category.categoryId,
          name: category.name,
          total: moneyOut(category.total),
          percentOfIncome: category.percentOfIncome
            ? {
                numerator: category.percentOfIncome.numerator.toString(),
                denominator: category.percentOfIncome.denominator.toString(),
              }
            : null,
          lines: category.lines.map((line) => ({
            commitmentId: line.commitmentId,
            name: line.name,
            amount: moneyOut(line.amount),
            isDue: line.isDue,
          })),
        })),
        combinedTotal: moneyOut(result.combinedTotal),
        remaining: moneyOut(result.remaining),
        retrievedAt: new Date().toISOString(),
      };
    }),
});
