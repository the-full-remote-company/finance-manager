import { issueSessionToken } from "@finance/auth";
import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";
import { protectedProcedure, router } from "../../src/trpc.js";

/**
 * FR-004, Story 1 scenario 3: an expired or revoked session reaches zero
 * workspace data on every protected procedure.
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

/** A stand-in protected procedure that reads a tenant table, per every protected procedure in the router. */
const probeRouter = router({
  probe: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.execute<{ count: string }>(
      sql`select count(*)::text as count from "users"`,
    );
    return result.rows[0]?.count ?? "0";
  }),
});

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

beforeEach(async () => {
  await ownerDb.execute(sql`truncate table "workspaces" cascade`);
});

function callerFor(db: Database, sessionToken: string | null) {
  const ctx: Context = { db, sessionToken, ip: null, setSessionCookie: vi.fn() };
  return { app: appRouter.createCaller(ctx), probe: probeRouter.createCaller(ctx) };
}

async function seedSession(options: {
  expired?: boolean;
  revoked?: boolean;
}): Promise<{ token: string; workspaceId: string }> {
  const workspace = await ownerDb.execute<{ id: string }>(
    sql`insert into "workspaces" ("name") values ('Haushalt') returning "id"`,
  );
  const workspaceId = workspace.rows[0]?.id;
  if (!workspaceId) throw new Error("seed failed");

  const user = await ownerDb.execute<{ id: string }>(
    sql`insert into "users" ("workspace_id", "email", "display_name", "password_hash")
        values (${workspaceId}, 'person@example.test', 'Person', 'hash') returning "id"`,
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

  return { token, workspaceId };
}

describe("session expiry (Story 1 scenario 3)", () => {
  it("an expired session reaches zero workspace data through a protected procedure", async () => {
    const { token } = await seedSession({ expired: true });
    const { probe } = callerFor(appDb, token);

    await expect(probe.probe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      cause: { appCode: "AUTH_FAILED" },
    });
  });

  it("a revoked session reaches zero workspace data through a protected procedure", async () => {
    const { token } = await seedSession({ revoked: true });
    const { probe } = callerFor(appDb, token);

    await expect(probe.probe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      cause: { appCode: "AUTH_FAILED" },
    });
  });

  it("auth.session returns null, not an error, for an expired session", async () => {
    const { token } = await seedSession({ expired: true });
    const { app } = callerFor(appDb, token);

    await expect(app.auth.session({})).resolves.toBeNull();
  });

  it("auth.session returns null, not an error, for a revoked session", async () => {
    const { token } = await seedSession({ revoked: true });
    const { app } = callerFor(appDb, token);

    await expect(app.auth.session({})).resolves.toBeNull();
  });

  it("auth.session returns null for no session at all", async () => {
    const { app } = callerFor(appDb, null);
    await expect(app.auth.session({})).resolves.toBeNull();
  });

  it("auth.session returns the session for a live token", async () => {
    const { token, workspaceId } = await seedSession({});
    const { app } = callerFor(appDb, token);

    await expect(app.auth.session({})).resolves.toMatchObject({
      workspaceId,
      displayName: "Person",
      locale: "de-DE",
    });
  });

  it("auth.signOut succeeds (idempotently) even with no live session", async () => {
    const { app } = callerFor(appDb, "not-a-real-token");
    await expect(app.auth.signOut({})).resolves.toEqual({ ok: true });
  });

  it("a session revoked by sign-out reaches zero workspace data afterwards", async () => {
    const { token } = await seedSession({});
    const { app, probe } = callerFor(appDb, token);

    await probe.probe();
    await app.auth.signOut({});

    await expect(probe.probe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
