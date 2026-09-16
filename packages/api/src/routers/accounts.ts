import { eq, inArray, or, schema, sql, type Database } from "@finance/db";
import { z } from "zod";
import { appError, notFound, toTrpcError } from "../errors.js";
import { isUniqueViolation } from "../pg-errors.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `accounts`, per contracts/procedures.md. A label for a place money sits —
 * no balance, no bank identifier (FR-007, Article VIII: no column without a
 * current consumer).
 *
 * Every resolver here runs inside `protectedProcedure`'s already-open,
 * workspace-scoped transaction (`ctx.db`); reads need no explicit
 * `workspace_id` filter because RLS supplies it, and a write supplies
 * `ctx.session.workspaceId` explicitly because `WITH CHECK` must have
 * something to compare against.
 */
const nameSchema = z.string().trim().min(1).max(120);
const noteSchema = z.string().max(2000);

export const accountsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/accounts", tags: ["accounts"] } })
    .input(z.object({}).strict())
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          note: z.string().nullable(),
          sortOrder: z.number().int(),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: schema.accounts.id,
          name: schema.accounts.name,
          note: schema.accounts.note,
          sortOrder: schema.accounts.sortOrder,
        })
        .from(schema.accounts)
        .orderBy(schema.accounts.sortOrder);
    }),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/accounts", tags: ["accounts"] } })
    .input(z.object({ name: nameSchema, note: noteSchema.optional() }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [{ next } = { next: 0 }] = await ctx.db
        .select({ next: sql<number>`coalesce(max(${schema.accounts.sortOrder}), -1) + 1` })
        .from(schema.accounts);

      try {
        const [row] = await ctx.db
          .insert(schema.accounts)
          .values({
            workspaceId: ctx.session.workspaceId,
            name: input.name,
            note: input.note ?? null,
            sortOrder: next,
          })
          .returning({ id: schema.accounts.id });
        if (!row) throw new Error("insert returned no row");
        return { id: row.id };
      } catch (error) {
        if (isUniqueViolation(error)) throw toTrpcError(appError("NAME_TAKEN"));
        throw error;
      }
    }),

  rename: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/accounts/rename", tags: ["accounts"] } })
    .input(z.object({ id: z.string(), name: nameSchema, note: noteSchema.nullable().optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.db
          .update(schema.accounts)
          .set({ name: input.name, note: input.note, updatedAt: new Date() })
          .where(eq(schema.accounts.id, input.id))
          .returning({ id: schema.accounts.id });

        if (result.length === 0) throw toTrpcError(notFound());
        return { ok: true as const };
      } catch (error) {
        if (isUniqueViolation(error)) throw toTrpcError(appError("NAME_TAKEN"));
        throw error;
      }
    }),

  reorder: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/accounts/reorder", tags: ["accounts"] } })
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(inArray(schema.accounts.id, input.ids));

      if (existing.length !== input.ids.length) throw toTrpcError(notFound());

      for (const [index, id] of input.ids.entries()) {
        await ctx.db
          .update(schema.accounts)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(schema.accounts.id, id));
      }

      return { ok: true as const };
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/accounts/delete", tags: ["accounts"] } })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, input.id));
      if (!row) throw toTrpcError(notFound());

      const referenceCount = await countAccountReferences(ctx.db, input.id);
      if (referenceCount > 0) {
        throw toTrpcError(appError("STILL_REFERENCED", { referenceCount }));
      }

      await ctx.db.delete(schema.accounts).where(eq(schema.accounts.id, input.id));
      return { ok: true as const };
    }),

  referenceCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/accounts/reference-count", tags: ["accounts"] } })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        asSource: z.number().int(),
        asTransferDestination: z.number().int(),
        total: z.number().int(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [asSourceRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.commitments)
        .where(eq(schema.commitments.sourceAccountId, input.id));
      const [asTransferRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.commitments)
        .where(eq(schema.commitments.transferAccountId, input.id));

      const asSource = asSourceRow?.count ?? 0;
      const asTransferDestination = asTransferRow?.count ?? 0;
      return { asSource, asTransferDestination, total: asSource + asTransferDestination };
    }),
});

/**
 * Both reference kinds — source and transfer destination — count toward the
 * total, per FR-009's edge case: "an account is deleted while referenced as a
 * source or as a transfer destination → both reference kinds count toward the
 * reported total."
 */
async function countAccountReferences(db: Database, accountId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.commitments)
    .where(
      or(
        eq(schema.commitments.sourceAccountId, accountId),
        eq(schema.commitments.transferAccountId, accountId),
      ),
    );
  return row?.count ?? 0;
}
