import {
  amountInForce,
  directionsAgree,
  dueMonthsInRange,
  formatMonth,
  monthOfIsoDate,
  type Direction,
  type Rhythm,
} from "@finance/core";
import { and, eq, schema, type Database } from "@finance/db";
import { z } from "zod";
import { appError, notFound, toTrpcError } from "../errors.js";
import {
  dateSchema,
  monthSchema,
  moneySchema,
  moneyOut,
  sharePercentSchema,
} from "../schemas/primitives.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `commitments`, per contracts/procedures.md. A standing income or expense —
 * not a payment; the amount actually charged lives in `commitment_amounts`
 * (`amounts.*`, a later story).
 */

const directionSchema = z.enum(["income", "expense"]);
const kindSchema = z.enum(["expense", "reserve"]);
const rhythmSchema = z.enum(["monthly", "quarterly", "half_yearly", "yearly", "one_off"]);

const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  direction: directionSchema,
  kind: kindSchema.optional().default("expense"),
  categoryId: z.string(),
  sourceAccountId: z.string(),
  transferAccountId: z.string().nullish(),
  sharePercent: sharePercentSchema,
  rhythm: rhythmSchema,
  anchorMonth: monthSchema.optional(),
  startDate: dateSchema,
  endDate: dateSchema.nullish(),
  noticeDeadline: dateSchema.nullish(),
  description: z.string().max(2000).nullish(),
  initialAmount: moneySchema,
});

/**
 * Every rule commitments.create validates in one transaction, named by the
 * error it raises (contracts/procedures.md's table). Shared with `update`,
 * which validates the same fields except `initialAmount`.
 */
function validateShapeRules(input: {
  rhythm: Rhythm;
  anchorMonth?: number | undefined;
  transferAccountId?: string | null | undefined;
  sourceAccountId: string;
  startDate: string;
  endDate?: string | null | undefined;
}): void {
  // FR-014: anchor month required for every rhythm except monthly.
  if (input.rhythm !== "monthly" && input.anchorMonth === undefined) {
    throw toTrpcError(appError("ANCHOR_REQUIRED"));
  }
  // FR-016: a transfer to the source account is not a transfer.
  if (
    input.transferAccountId !== null &&
    input.transferAccountId !== undefined &&
    input.transferAccountId === input.sourceAccountId
  ) {
    throw toTrpcError(appError("TRANSFER_EQUALS_SOURCE"));
  }
  // FR-017: contract end cannot precede the start. `YYYY-MM-DD` sorts
  // chronologically as a plain string, so no date parsing is needed here.
  if (input.endDate !== null && input.endDate !== undefined && input.endDate < input.startDate) {
    throw toTrpcError(appError("END_BEFORE_START"));
  }
}

/** Resolves the category's direction, scoped by RLS; NOT_FOUND for a missing or foreign row (FR-003). */
async function categoryDirection(db: Database, categoryId: string): Promise<Direction> {
  const [row] = await db
    .select({ direction: schema.categories.direction })
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId));
  if (!row) throw toTrpcError(notFound());
  return row.direction;
}

/** NOT_FOUND for an account id that does not resolve within the caller's workspace (FR-003). */
async function assertAccountExists(db: Database, accountId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId));
  if (!row) throw toTrpcError(notFound());
}

const commitmentSummaryOutput = z.object({
  id: z.string(),
  name: z.string(),
  direction: directionSchema,
  kind: kindSchema,
  categoryId: z.string(),
  categoryName: z.string(),
  sourceAccountId: z.string(),
  sourceAccountName: z.string(),
  transferAccountId: z.string().nullable(),
  transferAccountName: z.string().nullable(),
  sharePercent: z.number().int(),
  rhythm: rhythmSchema,
  anchorMonth: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  noticeDeadline: z.string().nullable(),
  description: z.string().nullable(),
  currentAmount: z.object({ minor: z.string(), currency: z.string() }),
});

async function loadSummaries(
  db: Database,
  filter?: {
    categoryId?: string | undefined;
    direction?: Direction | undefined;
    kind?: "expense" | "reserve" | undefined;
  },
) {
  const sourceAccounts = schema.accounts;

  const conditions = [];
  if (filter?.categoryId) conditions.push(eq(schema.commitments.categoryId, filter.categoryId));
  if (filter?.direction) conditions.push(eq(schema.commitments.direction, filter.direction));
  if (filter?.kind) conditions.push(eq(schema.commitments.kind, filter.kind));

  const rows = await db
    .select({
      id: schema.commitments.id,
      name: schema.commitments.name,
      direction: schema.commitments.direction,
      kind: schema.commitments.kind,
      categoryId: schema.commitments.categoryId,
      sourceAccountId: schema.commitments.sourceAccountId,
      transferAccountId: schema.commitments.transferAccountId,
      sharePercent: schema.commitments.sharePercent,
      rhythm: schema.commitments.rhythm,
      anchorMonth: schema.commitments.anchorMonth,
      startDate: schema.commitments.startDate,
      endDate: schema.commitments.endDate,
      noticeDeadline: schema.commitments.noticeDeadline,
      description: schema.commitments.description,
    })
    .from(schema.commitments)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const currentMonth = monthOfIsoDate(new Date().toISOString().slice(0, 10));

  const summaries = [];
  for (const row of rows) {
    const [category] = await db
      .select({ name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.id, row.categoryId));
    const [sourceAccount] = await db
      .select({ name: sourceAccounts.name })
      .from(sourceAccounts)
      .where(eq(sourceAccounts.id, row.sourceAccountId));
    const transferAccount = row.transferAccountId
      ? (
          await db
            .select({ name: sourceAccounts.name })
            .from(sourceAccounts)
            .where(eq(sourceAccounts.id, row.transferAccountId))
        )[0]
      : undefined;

    const amounts = await db
      .select({
        effectiveMonth: schema.commitmentAmounts.effectiveMonth,
        amountMinor: schema.commitmentAmounts.amountMinor,
        currency: schema.commitmentAmounts.currency,
      })
      .from(schema.commitmentAmounts)
      .where(eq(schema.commitmentAmounts.commitmentId, row.id));
    const override = await db
      .select({
        amountMinor: schema.amountOverrides.amountMinor,
        currency: schema.amountOverrides.currency,
      })
      .from(schema.amountOverrides)
      .where(
        and(
          eq(schema.amountOverrides.commitmentId, row.id),
          eq(schema.amountOverrides.month, currentMonth),
        ),
      );

    const inForce = amountInForce(
      amounts.map((amount) => ({ ...amount, effectiveMonth: amount.effectiveMonth ?? 0 })),
      currentMonth,
    );
    const currentMoney = override[0]
      ? { minor: override[0].amountMinor, currency: override[0].currency }
      : inForce
        ? { minor: inForce.amountMinor, currency: inForce.currency }
        : { minor: 0n, currency: "EUR" };

    summaries.push({
      id: row.id,
      name: row.name,
      direction: row.direction,
      kind: row.kind,
      categoryId: row.categoryId,
      categoryName: category?.name ?? "",
      sourceAccountId: row.sourceAccountId,
      sourceAccountName: sourceAccount?.name ?? "",
      transferAccountId: row.transferAccountId,
      transferAccountName: transferAccount?.name ?? null,
      sharePercent: row.sharePercent,
      rhythm: row.rhythm,
      anchorMonth: row.anchorMonth === null ? null : formatMonth(row.anchorMonth),
      startDate: row.startDate,
      endDate: row.endDate,
      noticeDeadline: row.noticeDeadline,
      description: row.description,
      currentAmount: moneyOut(currentMoney),
    });
  }
  return summaries;
}

export const commitmentsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/commitments", tags: ["commitments"] } })
    .input(
      z.object({
        categoryId: z.string().optional(),
        direction: directionSchema.optional(),
        kind: kindSchema.optional(),
      }),
    )
    .output(z.array(commitmentSummaryOutput))
    .query(async ({ ctx, input }) => loadSummaries(ctx.db, input)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/commitments/{id}", tags: ["commitments"] } })
    .input(z.object({ id: z.string() }))
    .output(
      commitmentSummaryOutput.extend({
        amounts: z.array(
          z.object({
            id: z.string(),
            effectiveFrom: z.string(),
            amount: z.object({ minor: z.string(), currency: z.string() }),
          }),
        ),
        overrides: z.array(
          z.object({
            id: z.string(),
            month: z.string(),
            amount: z.object({ minor: z.string(), currency: z.string() }),
          }),
        ),
        dueMonths: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          startMonth: schema.commitments.startMonth,
          endMonth: schema.commitments.endMonth,
          rhythm: schema.commitments.rhythm,
          anchorMonth: schema.commitments.anchorMonth,
        })
        .from(schema.commitments)
        .where(eq(schema.commitments.id, input.id));
      if (!row) throw toTrpcError(notFound());

      const [summary] = await loadSummaries(ctx.db, undefined).then((all) =>
        all.filter((entry) => entry.id === input.id),
      );
      if (!summary) throw toTrpcError(notFound());

      const amountRows = await ctx.db
        .select({
          id: schema.commitmentAmounts.id,
          effectiveFrom: schema.commitmentAmounts.effectiveFrom,
          amountMinor: schema.commitmentAmounts.amountMinor,
          currency: schema.commitmentAmounts.currency,
        })
        .from(schema.commitmentAmounts)
        .where(eq(schema.commitmentAmounts.commitmentId, input.id));

      const overrideRows = await ctx.db
        .select({
          id: schema.amountOverrides.id,
          month: schema.amountOverrides.month,
          amountMinor: schema.amountOverrides.amountMinor,
          currency: schema.amountOverrides.currency,
        })
        .from(schema.amountOverrides)
        .where(eq(schema.amountOverrides.commitmentId, input.id));

      const currentMonth = monthOfIsoDate(new Date().toISOString().slice(0, 10));
      const horizonEnd = currentMonth + 24;
      const dueMonths =
        row.startMonth === null
          ? []
          : dueMonthsInRange(
              currentMonth - 24,
              horizonEnd,
              row.rhythm,
              row.anchorMonth,
              row.startMonth,
              row.endMonth,
            );

      return {
        ...summary,
        amounts: amountRows.map((amount) => ({
          id: amount.id,
          effectiveFrom: amount.effectiveFrom,
          amount: moneyOut({ minor: amount.amountMinor, currency: amount.currency }),
        })),
        overrides: overrideRows.map((override) => ({
          id: override.id,
          month: formatMonth(override.month),
          amount: moneyOut({ minor: override.amountMinor, currency: override.currency }),
        })),
        dueMonths: dueMonths.map((month) => formatMonth(month)),
      };
    }),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/commitments", tags: ["commitments"] } })
    .input(createInput)
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      validateShapeRules(input);

      const categoryDir = await categoryDirection(ctx.db, input.categoryId);
      await assertAccountExists(ctx.db, input.sourceAccountId);
      if (input.transferAccountId) await assertAccountExists(ctx.db, input.transferAccountId);

      // FR-011: a commitment's direction and its category's must agree.
      if (!directionsAgree(input.direction, categoryDir)) {
        throw toTrpcError(appError("DIRECTION_MISMATCH", { categoryDirection: categoryDir }));
      }

      const [commitmentRow] = await ctx.db
        .insert(schema.commitments)
        .values({
          workspaceId: ctx.session.workspaceId,
          name: input.name,
          direction: input.direction,
          kind: input.kind,
          categoryId: input.categoryId,
          sourceAccountId: input.sourceAccountId,
          transferAccountId: input.transferAccountId ?? null,
          sharePercent: input.sharePercent,
          rhythm: input.rhythm,
          anchorMonth: input.anchorMonth ?? null,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          noticeDeadline: input.noticeDeadline ?? null,
          description: input.description ?? null,
        })
        .returning({ id: schema.commitments.id });
      if (!commitmentRow) throw new Error("insert returned no row");

      // FR-011: at least one amount, effective at or before the start month —
      // enforced here, in the same transaction, per data-model.md.
      await ctx.db.insert(schema.commitmentAmounts).values({
        workspaceId: ctx.session.workspaceId,
        commitmentId: commitmentRow.id,
        effectiveFrom: input.startDate,
        amountMinor: input.initialAmount.minor,
        currency: input.initialAmount.currency,
      });

      return { id: commitmentRow.id };
    }),

  update: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/commitments/update", tags: ["commitments"] } })
    .input(createInput.omit({ initialAmount: true }).partial().extend({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({
          direction: schema.commitments.direction,
          categoryId: schema.commitments.categoryId,
          sourceAccountId: schema.commitments.sourceAccountId,
          transferAccountId: schema.commitments.transferAccountId,
          rhythm: schema.commitments.rhythm,
          anchorMonth: schema.commitments.anchorMonth,
          startDate: schema.commitments.startDate,
          endDate: schema.commitments.endDate,
        })
        .from(schema.commitments)
        .where(eq(schema.commitments.id, input.id));
      if (!existing) throw toTrpcError(notFound());

      const merged = {
        direction: input.direction ?? existing.direction,
        categoryId: input.categoryId ?? existing.categoryId,
        sourceAccountId: input.sourceAccountId ?? existing.sourceAccountId,
        transferAccountId:
          input.transferAccountId !== undefined
            ? input.transferAccountId
            : existing.transferAccountId,
        rhythm: input.rhythm ?? existing.rhythm,
        anchorMonth:
          input.anchorMonth ?? (existing.anchorMonth === null ? undefined : existing.anchorMonth),
        startDate: input.startDate ?? existing.startDate,
        endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      };

      validateShapeRules(merged);

      if (input.categoryId || input.direction) {
        const categoryDir = await categoryDirection(ctx.db, merged.categoryId);
        if (!directionsAgree(merged.direction, categoryDir)) {
          throw toTrpcError(appError("DIRECTION_MISMATCH", { categoryDirection: categoryDir }));
        }
      }
      if (input.sourceAccountId) await assertAccountExists(ctx.db, input.sourceAccountId);
      if (input.transferAccountId) await assertAccountExists(ctx.db, input.transferAccountId);

      // Amounts are never changed here (Story 8): only commitment fields.
      await ctx.db
        .update(schema.commitments)
        .set({
          name: input.name,
          direction: input.direction,
          kind: input.kind,
          categoryId: input.categoryId,
          sourceAccountId: input.sourceAccountId,
          transferAccountId: input.transferAccountId,
          sharePercent: input.sharePercent,
          rhythm: input.rhythm,
          anchorMonth: input.anchorMonth,
          startDate: input.startDate,
          endDate: input.endDate,
          noticeDeadline: input.noticeDeadline,
          description: input.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.commitments.id, input.id));

      return { ok: true as const };
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/commitments/delete", tags: ["commitments"] } })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: schema.commitments.id })
        .from(schema.commitments)
        .where(eq(schema.commitments.id, input.id));
      if (!row) throw toTrpcError(notFound());

      // Cascades to amounts and overrides by FK, per data-model.md — the
      // commitment disappears from every month in the horizon, including
      // past months (Story 2 scenario 5).
      await ctx.db.delete(schema.commitments).where(eq(schema.commitments.id, input.id));
      return { ok: true as const };
    }),
});
