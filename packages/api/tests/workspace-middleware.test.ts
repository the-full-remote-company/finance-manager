import { hashSessionToken, issueSessionToken } from "@finance/auth";
import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Context } from "../src/context.js";
import { protectedProcedure, publicProcedure, router } from "../src/trpc.js";

/**
 * Article I: "Application-layer scoping in tRPC middleware is required in
 * addition, never instead." This exercises both layers through a real router
 * against real PostgreSQL, as the non-owner app role.
 */
const appPool = createPool({
  connectionString: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/finance",
});
const ownerPool = createPool({
  connectionString:
    process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance",
});
const appDb = createDatabase(appPool);
const ownerDb = createDatabase(ownerPool);

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

/** A router that simply reports what the middleware resolved, and reads a tenant table. */
const testRouter = router({
  whoami: protectedProcedure.query(({ ctx }) => ctx.session),
  countUsers: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.execute<{ count: string }>(
      sql`select count(*)::text as count from "users"`,
    );
    return result.rows[0]?.count ?? "0";
  }),
  readUserById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.execute<{ count: string }>(
        sql`select count(*)::text as count from "users" where "id" = ${input.id}`,
      );
      return result.rows[0]?.count ?? "0";
    }),
  ping: publicProcedure.query(() => "pong"),
});

function caller(sessionToken: string | null, db: Database = appDb) {
  const ctx: Context = { db, sessionToken, ip: null };
  return testRouter.createCaller(ctx);
}

interface Seeded {
  workspaceId: string;
  userId: string;
  token: string;
}

async function seed(
  name: string,
  options: { expired?: boolean; revoked?: boolean } = {},
): Promise<Seeded> {
  const workspace = await ownerDb.execute<{ id: string }>(
    sql`insert into "workspaces" ("name") values (${name}) returning "id"`,
  );
  const workspaceId = workspace.rows[0]?.id;
  if (!workspaceId) throw new Error("seed failed");

  const user = await ownerDb.execute<{ id: string }>(
    sql`insert into "users" ("workspace_id", "email", "display_name", "password_hash")
        values (${workspaceId}, ${`${name}@example.test`}, ${name}, 'hash') returning "id"`,
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("seed failed");

  const { token, tokenHash } = issueSessionToken();
  const expiresAt = options.expired
    ? sql`now() - interval '1 hour'`
    : sql`now() + interval '30 days'`;
  const revokedAt = options.revoked ? sql`now()` : sql`null`;

  await ownerDb.execute(
    sql`insert into "sessions" ("workspace_id", "user_id", "token_hash", "expires_at", "revoked_at")
        values (${workspaceId}, ${userId}, ${tokenHash}, ${expiresAt}, ${revokedAt})`,
  );

  return { workspaceId, userId, token };
}

describe("workspace middleware", () => {
  let alpha: Seeded;
  let beta: Seeded;

  beforeEach(async () => {
    await ownerDb.execute(sql`truncate table "workspaces" cascade`);
    alpha = await seed("alpha");
    beta = await seed("beta");
  });

  it("resolves the session to its workspace", async () => {
    const session = await caller(alpha.token).whoami();

    expect(session.workspaceId).toBe(alpha.workspaceId);
    expect(session.userId).toBe(alpha.userId);
  });

  it("scopes reads to the session's workspace", async () => {
    // Two users exist. The caller must see exactly one.
    expect(await caller(alpha.token).countUsers()).toBe("1");
    expect(await caller(beta.token).countUsers()).toBe("1");
  });

  it("cannot read another workspace's record by direct id (FR-003)", async () => {
    expect(await caller(alpha.token).readUserById({ id: beta.userId })).toBe("0");
  });

  it("refuses a request with no session token", async () => {
    await expect(caller(null).whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses an unknown session token", async () => {
    await expect(caller("not-a-real-token").whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("refuses an expired session (Story 1 scenario 3)", async () => {
    const expired = await seed("expired-workspace", { expired: true });
    await expect(caller(expired.token).whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses a revoked session, whatever its expiry", async () => {
    const revoked = await seed("revoked-workspace", { revoked: true });
    await expect(caller(revoked.token).whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("gives the same answer for an unknown, expired and revoked session", async () => {
    // Three different internal states, one external answer. Distinguishing
    // them would tell an attacker whether a token ever existed.
    const expired = await seed("e2", { expired: true });
    const revoked = await seed("r2", { revoked: true });

    const errors = await Promise.all(
      [caller("unknown-token"), caller(expired.token), caller(revoked.token)].map(async (c) => {
        try {
          await c.whoami();
          return null;
        } catch (error) {
          return {
            code: (error as { code: string }).code,
            message: (error as { message: string }).message,
          };
        }
      }),
    );

    expect(errors[0]).not.toBeNull();
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[2]).toEqual(errors[0]);
  });

  it("leaves no workspace setting behind on the pooled connection", async () => {
    await caller(alpha.token).whoami();

    const after = await appDb.execute<{ setting: string | null }>(
      sql`select nullif(current_setting('app.workspace_id', true), '') as setting`,
    );
    expect(after.rows[0]?.setting).toBeNull();
  });

  it("does not require a session for a public procedure", async () => {
    expect(await caller(null).ping()).toBe("pong");
  });

  it("stores only the hash: the raw token is not in the database", async () => {
    const result = await ownerDb.execute<{ count: string }>(
      sql`select count(*)::text as count from "sessions" where "token_hash" = ${alpha.token}`,
    );
    expect(result.rows[0]?.count).toBe("0");

    const byHash = await ownerDb.execute<{ count: string }>(
      sql`select count(*)::text as count from "sessions" where "token_hash" = ${hashSessionToken(alpha.token)}`,
    );
    expect(byHash.rows[0]?.count).toBe("1");
  });
});
