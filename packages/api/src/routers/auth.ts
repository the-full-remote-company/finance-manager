import { createHash, randomUUID } from "node:crypto";
import {
  composeConfirmToken,
  hashPassword,
  issueConfirmToken,
  issueSessionToken,
  parseConfirmToken,
  recordAuditEvent,
  sendConfirmationEmail,
  supersedePreviousTokens,
  verifyConfirmToken,
  verifyPassword,
} from "@finance/auth";
import { sql, withWorkspace } from "@finance/db";
import { z } from "zod";
import { appError, toTrpcError } from "../errors.js";
import { AUTH_RATE_LIMIT, consumeRateLimit } from "../middleware/rate-limit.js";
import { isUniqueViolation } from "../pg-errors.js";
import { publicProcedure, resolveSession, router } from "../trpc.js";

/**
 * `auth`, per contracts/procedures.md and ADR 0003.
 *
 * Every procedure here is `publicProcedure`: this is the exempt set
 * `packages/api/tests/exempt-procedures.test.ts` asserts, alongside
 * `health.ping`. Each resolves its own session where it needs one, rather
 * than through `protectedProcedure`, because `auth.session` must answer
 * `null` for an absent session rather than throw, and `auth.signOut` must
 * succeed (idempotently) even when the caller's session already died.
 */

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 720) * 60 * 60 * 1000;

/** Case-insensitive per `users_email_lower_key`; normalised once, at the boundary. */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const authRouter = router({
  register: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/register",
        tags: ["auth"],
        summary: "Register and create the registrant's workspace",
        // Unauthenticated by definition: this is how a session is obtained.
        protect: false,
      },
    })
    .input(
      z.object({
        email: emailSchema,
        password: z.string().min(12),
        displayName: z.string().min(1).max(120),
      }),
    )
    .output(z.object({ userId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await consumeRateLimit(ctx.db, { identifier: input.email, ip: ctx.ip }, AUTH_RATE_LIMIT);

      // Argon2id runs before the collision is known, and takes the same time
      // either way: it is what keeps a duplicate email's response in the same
      // timing class as success (ADR 0003), not a branch added for the
      // purpose.
      const passwordHash = await hashPassword(input.password);

      // Generated here, before either row exists, so the transaction can be
      // opened with the workspace it is about to create — no unscoped read
      // of `users` is needed to detect a collision (ADR 0008): the unique
      // index on lower(email) raises 23505 regardless of row visibility.
      const workspaceId = randomUUID();
      const userId = randomUUID();

      try {
        await withWorkspace(ctx.db, workspaceId, async (tx) => {
          await tx.execute(
            sql`insert into "workspaces" ("id", "name") values (${workspaceId}, ${input.displayName})`,
          );
          // Feature 002: confirmed = false for new registrations (FR-001)
          await tx.execute(
            sql`insert into "users" ("id", "workspace_id", "email", "display_name", "password_hash", "confirmed")
                values (${userId}, ${workspaceId}, ${input.email}, ${input.displayName}, ${passwordHash}, false)`,
          );
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        // FR-011/ADR 0003: the response does not disclose that the address
        // is already registered. Same shape, same timing class as success —
        // and NO session is created, NO email is sent (enumeration resistance).
        return { userId, workspaceId };
      }

      // Feature 002: Issue confirmation token and send email (FR-002)
      const {
        raw: confirmToken,
        hash: confirmHash,
        expiresAt: confirmExpiresAt,
      } = issueConfirmToken();

      await withWorkspace(ctx.db, workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into "confirmation_tokens" ("workspace_id", "user_id", "token_hash", "expires_at")
              values (${workspaceId}, ${userId}, ${confirmHash}, ${confirmExpiresAt})`,
        );
      });

      // Send confirmation email (FR-002, FR-017: send failures are logged, not shown)
      const confirmLink = `${process.env.APP_BASE_URL || "http://localhost:3000"}/confirm?token=${composeConfirmToken(workspaceId, confirmToken)}`;
      await sendConfirmationEmail(input.email, confirmLink);

      // Feature 002: NO session cookie is set (FR-001)
      // Registration is not in FR-006's audited list (contracts/procedures.md).

      return { userId, workspaceId };
    }),

  signIn: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/sign-in",
        tags: ["auth"],
        summary: "Sign in",
        protect: false,
      },
    })
    .input(z.object({ email: emailSchema, password: z.string().min(1) }))
    .output(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await consumeRateLimit(ctx.db, { identifier: input.email, ip: ctx.ip }, AUTH_RATE_LIMIT);

      // ADR 0008: the same bootstrap ADR 0007 uses for a session token,
      // applied one step earlier, because a workspace cannot be scoped
      // before the matching user row is found.
      // Feature 002: also fetch confirmed field
      const found = await ctx.db.execute<{
        user_id: string;
        workspace_id: string;
        password_hash: string;
        confirmed: boolean;
      }>(sql`select * from app_authenticate(${input.email})`);
      const row = found.rows[0];

      // The hash is still run on an unknown address, against nothing, so an
      // unknown user and a wrong password cost the same time (ADR 0003) —
      // never short-circuited by `row === undefined`.
      const valid = await verifyPassword(row?.password_hash ?? "", input.password);

      if (!row || !valid) {
        // FR-006/FR-020: audited on failure too. No workspace is known for an
        // unknown address; for a known one with a wrong password, the event
        // still carries no workspace, so the two failures stay
        // indistinguishable in the log as well as on the wire.
        // Unconfirmed accounts with wrong passwords also fall here (enumeration resistance).
        await recordAuditEvent(ctx.db, {
          type: "sign_in_failed",
          workspaceId: null,
          userId: null,
          ip: ctx.ip,
        });
        throw toTrpcError(appError("AUTH_FAILED"));
      }

      // Feature 002: Check confirmation status after password verification (FR-020)
      // Wrong password already threw above, so this branch reveals only what the caller knows.
      if (!row.confirmed) {
        // Audit as sign_in_failed (unconfirmed account, no workspace in event)
        await recordAuditEvent(ctx.db, {
          type: "sign_in_failed",
          workspaceId: null,
          userId: null,
          ip: ctx.ip,
        });
        throw toTrpcError(appError("ACCOUNT_NOT_CONFIRMED", { email: input.email }));
      }

      const { token, tokenHash } = issueSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await withWorkspace(ctx.db, row.workspace_id, async (tx) => {
        await tx.execute(
          sql`insert into "sessions" ("workspace_id", "user_id", "token_hash", "expires_at")
              values (${row.workspace_id}, ${row.user_id}, ${tokenHash}, ${expiresAt})`,
        );
        await recordAuditEvent(tx, {
          type: "sign_in_succeeded",
          workspaceId: row.workspace_id,
          userId: row.user_id,
          ip: ctx.ip,
        });
      });

      ctx.setSessionCookie?.(token, expiresAt);
      return { workspaceId: row.workspace_id };
    }),

  signOut: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/sign-out",
        tags: ["auth"],
        summary: "Sign out",
        protect: false,
      },
    })
    // `{}`, not `z.void()`: `@trpc/server`'s fetch adapter unconditionally
    // calls `req.json()` for a POST body and throws `SyntaxError: Unexpected
    // end of JSON input` on a genuinely empty one, which is exactly what
    // `@trpc/client`'s httpLink sends for a mutation called with no
    // argument. An explicit empty object is a one-byte, always-valid body —
    // and matches contracts/procedures.md's own `in {}` for this procedure.
    .input(z.object({}).strict())
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      const session = await resolveSession(ctx.db, ctx.sessionToken);

      if (session) {
        await withWorkspace(ctx.db, session.workspaceId, async (tx) => {
          await tx.execute(sql`delete from "sessions" where "id" = ${session.sessionId}`);
          await recordAuditEvent(tx, {
            type: "signed_out",
            workspaceId: session.workspaceId,
            userId: session.userId,
            ip: ctx.ip,
          });
        });
      }

      // Idempotent: a caller with no session, or an already-dead one, still
      // gets a cleared cookie and an ok response — never AUTH_FAILED. The
      // client purges every cache and the persisted query store on this same
      // path regardless (FR-035e, asserted end-to-end, not here).
      ctx.clearSessionCookie?.();
      return { ok: true as const };
    }),

  session: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/auth/session",
        tags: ["auth"],
        summary: "The current session, or null",
        // Answers null rather than requiring auth, per contracts/procedures.md.
        protect: false,
      },
    })
    // `{}`, matching contracts/procedures.md's `in {}` and `auth.signOut`'s
    // input above for the same reason, even though a GET query is immune to
    // the empty-POST-body issue: `@trpc/server` reads a GET's input from an
    // optional `?input=` query parameter and defaults cleanly to `{}` when
    // it is absent.
    .input(z.object({}).strict())
    .output(
      z
        .object({
          userId: z.string(),
          workspaceId: z.string(),
          displayName: z.string(),
          locale: z.string(),
        })
        .nullable(),
    )
    .query(async ({ ctx }) => {
      const session = await resolveSession(ctx.db, ctx.sessionToken);
      if (!session) return null;

      return withWorkspace(ctx.db, session.workspaceId, async (tx) => {
        const found = await tx.execute<{ display_name: string }>(
          sql`select "display_name" from "users" where "id" = ${session.userId}`,
        );
        const displayName = found.rows[0]?.display_name;
        // The user row vanished mid-session (deleted account, revoked
        // elsewhere) — the same "no session" answer, not a 500.
        if (displayName === undefined) return null;

        return {
          userId: session.userId,
          workspaceId: session.workspaceId,
          displayName,
          // FR-042: one locale exists. Fixed here rather than read from
          // anywhere, because there is nowhere else it could differ from.
          locale: "de-DE",
        };
      });
    }),

  confirm: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/confirm",
        tags: ["auth"],
        summary: "Confirm email via token",
        protect: false,
      },
    })
    .input(z.object({ token: z.string().min(1) }))
    .output(z.object({ userId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // The link carries `<workspaceId>.<secret>`. The workspace id is not a
      // secret; it only lets the lookup run in a workspace-scoped transaction,
      // under ordinary row-level security, with no privileged function.
      const parsed = parseConfirmToken(input.token);

      type Outcome =
        | { kind: "invalid" }
        | { kind: "already_confirmed" }
        | {
            kind: "confirmed";
            userId: string;
            workspaceId: string;
            sessionToken: string;
            expiresAt: Date;
          };

      const outcome: Outcome = parsed
        ? await withWorkspace(ctx.db, parsed.workspaceId, async (tx): Promise<Outcome> => {
            const tokenHash = createHash("sha256").update(parsed.raw).digest("hex");

            // `for update`: two concurrent opens of one link serialise here, so
            // only one can consume it.
            const found = await tx.execute<{
              user_id: string;
              expires_at: Date;
              superseded_at: Date | null;
            }>(
              sql`select "user_id", "expires_at", "superseded_at"
                  from "confirmation_tokens"
                  where "token_hash" = ${tokenHash}
                  for update`,
            );
            const row = found.rows[0];
            if (
              !row ||
              !verifyConfirmToken({
                providedRaw: parsed.raw,
                storedHash: tokenHash,
                expiresAt: new Date(row.expires_at),
                supersededAt: row.superseded_at === null ? null : new Date(row.superseded_at),
              })
            ) {
              return { kind: "invalid" };
            }

            const user = await tx.execute<{ confirmed: boolean }>(
              sql`select "confirmed" from "users" where "id" = ${row.user_id}`,
            );
            // The account was deleted after the token was issued.
            if (!user.rows[0]) return { kind: "invalid" };
            if (user.rows[0].confirmed) return { kind: "already_confirmed" };

            await tx.execute(
              sql`update "users" set "confirmed" = true, "confirmed_at" = now()
                  where "id" = ${row.user_id}`,
            );
            // Single use (FR-005): every token for this user goes, including
            // superseded ones.
            await tx.execute(
              sql`delete from "confirmation_tokens" where "user_id" = ${row.user_id}`,
            );

            const { token: sessionToken, tokenHash: sessionHash } = issueSessionToken();
            const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
            await tx.execute(
              sql`insert into "sessions" ("workspace_id", "user_id", "token_hash", "expires_at")
                  values (${parsed.workspaceId}, ${row.user_id}, ${sessionHash}, ${expiresAt})`,
            );
            await recordAuditEvent(tx, {
              type: "account_confirmed",
              workspaceId: parsed.workspaceId,
              userId: row.user_id,
              ip: ctx.ip,
            });

            return {
              kind: "confirmed",
              userId: row.user_id,
              workspaceId: parsed.workspaceId,
              sessionToken,
              expiresAt,
            };
          })
        : { kind: "invalid" };

      if (outcome.kind !== "confirmed") {
        // Outside the transaction above, which has ended. Attributed to no
        // workspace and no user: nothing was proven about who is asking.
        await recordAuditEvent(ctx.db, {
          type: "confirmation_failed",
          workspaceId: null,
          userId: null,
          ip: ctx.ip,
        });
        throw toTrpcError(
          appError(outcome.kind === "already_confirmed" ? "ALREADY_CONFIRMED" : "TOKEN_INVALID"),
        );
      }

      ctx.setSessionCookie?.(outcome.sessionToken, outcome.expiresAt);
      return { userId: outcome.userId, workspaceId: outcome.workspaceId };
    }),

  resendConfirmation: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/auth/resend-confirmation",
        tags: ["auth"],
        summary: "Resend confirmation email",
        protect: false,
      },
    })
    .input(z.object({ email: emailSchema }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await consumeRateLimit(ctx.db, { identifier: input.email, ip: ctx.ip }, AUTH_RATE_LIMIT);

      // The same bootstrap sign-in uses (ADR 0008): no workspace is known yet,
      // and `users` is under forced row-level security, so a plain select here
      // would see nothing.
      const found = await ctx.db.execute<{
        user_id: string;
        workspace_id: string;
        confirmed: boolean;
      }>(sql`select "user_id", "workspace_id", "confirmed" from app_authenticate(${input.email})`);
      const user = found.rows[0];

      // FR-009: the same response whether the address is unknown, confirmed
      // or unconfirmed (enumeration resistance).
      if (!user || user.confirmed) {
        return { ok: true as const };
      }

      const { raw, hash, expiresAt } = issueConfirmToken();
      const supersededAt = supersedePreviousTokens();

      await withWorkspace(ctx.db, user.workspace_id, async (tx) => {
        // FR-008: every earlier unused token stops working.
        await tx.execute(
          sql`update "confirmation_tokens" set "superseded_at" = ${supersededAt}
              where "user_id" = ${user.user_id} and "superseded_at" is null`,
        );
        await tx.execute(
          sql`insert into "confirmation_tokens" ("workspace_id", "user_id", "token_hash", "expires_at")
              values (${user.workspace_id}, ${user.user_id}, ${hash}, ${expiresAt})`,
        );
        await recordAuditEvent(tx, {
          type: "confirmation_resent",
          workspaceId: user.workspace_id,
          userId: user.user_id,
          ip: ctx.ip,
        });
      });

      // FR-017: a send failure is logged inside, never surfaced.
      const link = `${process.env.APP_BASE_URL || "http://localhost:3000"}/confirm?token=${composeConfirmToken(user.workspace_id, raw)}`;
      await sendConfirmationEmail(input.email, link);

      return { ok: true as const };
    }),
});
