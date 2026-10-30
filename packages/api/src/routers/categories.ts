import { eq, inArray, schema, sql } from "@finance/db";
import { z } from "zod";
import { appError, notFound, toTrpcError } from "../errors.js";
import { isUniqueViolation } from "../pg-errors.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * `categories`, per contracts/procedures.md: "mirrors accounts exactly", with
 * `direction` added and made immutable after creation — changing it would
 * silently move every referencing commitment between the income and expense
 * totals (data-model.md).
 */
const nameSchema = z.string().trim().min(1).max(120);
const directionSchema = z.enum(["income", "expense"]);

export const categoriesRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/categories", tags: ["categories"] } })
    .input(z.object({}).strict())
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          direction: directionSchema,
          sortOrder: z.number().int(),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: schema.categories.id,
          name: schema.categories.name,
          direction: schema.categories.direction,
          sortOrder: schema.categories.sortOrder,
        })
        .from(schema.categories)
        .orderBy(schema.categories.sortOrder);
    }),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/categories", tags: ["categories"] } })
    .input(z.object({ name: nameSchema, direction: directionSchema }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [{ next } = { next: 0 }] = await ctx.db
        .select({ next: sql<number>`coalesce(max(${schema.categories.sortOrder}), -1) + 1` })
        .from(schema.categories);

      try {
        const [row] = await ctx.db
          .insert(schema.categories)
          .values({
            workspaceId: ctx.session.workspaceId,
            name: input.name,
            direction: input.direction,
            sortOrder: next,
          })
          .returning({ id: schema.categories.id });
        if (!row) throw new Error("insert returned no row");
        return { id: row.id };
      } catch (error) {
        if (isUniqueViolation(error)) throw toTrpcError(appError("NAME_TAKEN"));
        throw error;
      }
    }),

  rename: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/categories/rename", tags: ["categories"] } })
    .input(
      z.object({
        id: z.string(),
        name: nameSchema,
        // Present only to detect an attempted direction change: this
        // procedure never writes it. FR-009a: a rename is invisible to the
        // reference, since the reference is by id.
        direction: directionSchema.optional(),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ direction: schema.categories.direction })
        .from(schema.categories)
        .where(eq(schema.categories.id, input.id));
      if (!existing) throw toTrpcError(notFound());

      if (input.direction !== undefined && input.direction !== existing.direction) {
        throw toTrpcError(appError("DIRECTION_IMMUTABLE"));
      }

      try {
        await ctx.db
          .update(schema.categories)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(schema.categories.id, input.id));
        return { ok: true as const };
      } catch (error) {
        if (isUniqueViolation(error)) throw toTrpcError(appError("NAME_TAKEN"));
        throw error;
      }
    }),

  reorder: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/categories/reorder", tags: ["categories"] } })
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(inArray(schema.categories.id, input.ids));

      if (existing.length !== input.ids.length) throw toTrpcError(notFound());

      for (const [index, id] of input.ids.entries()) {
        await ctx.db
          .update(schema.categories)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(schema.categories.id, id));
      }

      return { ok: true as const };
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/categories/delete", tags: ["categories"] } })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.id, input.id));
      if (!row) throw toTrpcError(notFound());

      const [countRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.commitments)
        .where(eq(schema.commitments.categoryId, input.id));
      const referenceCount = countRow?.count ?? 0;

      if (referenceCount > 0) {
        throw toTrpcError(appError("STILL_REFERENCED", { referenceCount }));
      }

      await ctx.db.delete(schema.categories).where(eq(schema.categories.id, input.id));
      return { ok: true as const };
    }),

  referenceCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/categories/reference-count", tags: ["categories"] } })
    .input(z.object({ id: z.string() }))
    .output(z.object({ total: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.commitments)
        .where(eq(schema.commitments.categoryId, input.id));
      return { total: row?.count ?? 0 };
    }),
});
