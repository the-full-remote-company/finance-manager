import { hashSessionToken, isExpired } from "@finance/auth";
import { sql, withWorkspace } from "@finance/db";
import { initTRPC } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import { ZodError } from "zod";
import type { AuthenticatedContext, Context } from "./context.js";
import { appError, toTrpcError, type AppError } from "./errors.js";

/**
 * tRPC initialisation.
 *
 * `superjson` is deliberately NOT used. Money crosses the wire as a decimal
 * string of minor units so that a Swift client can consume the generated
 * OpenAPI document without a TypeScript-specific decoder (contracts/README.md,
 * Article VI). A transformer would make the document TypeScript-only, which is
 * the outcome generating it exists to avoid.
 */
const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
  .create({
    errorFormatter({ shape, error }) {
      // Every error leaves with data.appCode, so the client can select its
      // translated string by code and never parse a message.
      const cause = error.cause as AppError | undefined;

      if (error.cause instanceof ZodError) {
        const first = error.cause.issues[0];
        return {
          ...shape,
          message: "validation_failed",
          data: {
            ...shape.data,
            appCode: "VALIDATION_FAILED",
            details: { path: first ? first.path.map(String) : [] },
          },
        };
      }

      if (cause?.appCode !== undefined) {
        return {
          ...shape,
          data: {
            ...shape.data,
            appCode: cause.appCode,
            ...(cause.details === undefined ? {} : { details: cause.details }),
          },
        };
      }

      // An unmapped error must not leak its message to the client: it may
      // carry a query, a value, or a path (Article VIII).
      return { ...shape, message: "internal_error", data: { ...shape.data, appCode: "INTERNAL" } };
    },
  });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * The four unauthenticated procedures, per contracts/README.md:
 * auth.register, auth.signIn, auth.signOut and health.ping.
 */
export const publicProcedure = t.procedure;

/**
 * Authenticated, workspace-scoped procedure.
 *
 * Two independent layers, both mandatory (Article I):
 *
 *  1. the session is resolved and the workspace pinned here, in application
 *     code, and
 *  2. the whole resolver runs inside withWorkspace, so every statement it
 *     issues is additionally filtered by the database's RLS policies.
 *
 * "Application-layer scoping in tRPC middleware is required in addition, never
 * instead."
 */
function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.sessionToken === null || ctx.sessionToken.length === 0) {
    throw toTrpcError(appError("AUTH_FAILED"));
  }

  const tokenHash = hashSessionToken(ctx.sessionToken);

  // The bootstrap, per ADR 0007. `sessions` is RLS-protected and no workspace
  // is in scope yet, so a direct select would correctly return zero rows and
  // authentication could never start. app_resolve_session is a narrow
  // SECURITY DEFINER function taking a hash and returning five non-secret
  // fields — the only path by which this role reads a tenant table unscoped,
  // and a test asserts it stays the only one.
  const found = await ctx.db.execute<{
    session_id: string;
    user_id: string;
    workspace_id: string;
    // The driver hands timestamptz back as a string through Drizzle's type
    // parsers, not as a Date. Typed honestly and normalised below rather than
    // asserted to be a Date, which failed at runtime while type-checking
    // cleanly — the worst combination.
    expires_at: string | Date;
    revoked_at: string | Date | null;
  }>(sql`select * from app_resolve_session(${tokenHash})`);

  const session = found.rows[0];
  if (
    !session ||
    isExpired({
      expiresAt: toDate(session.expires_at),
      revokedAt: session.revoked_at === null ? null : toDate(session.revoked_at),
    })
  ) {
    // Story 1 scenario 3: an expired or revoked session reaches no data.
    // Identical error either way: "no such session" and "your session died"
    // are the same answer to the client.
    throw toTrpcError(appError("AUTH_FAILED"));
  }

  return withWorkspace(ctx.db, session.workspace_id, async (tx) => {
    const authenticated: AuthenticatedContext = {
      ...ctx,
      db: tx,
      session: {
        sessionId: session.session_id,
        userId: session.user_id,
        workspaceId: session.workspace_id,
      },
    };
    return next({ ctx: authenticated });
  });
});
