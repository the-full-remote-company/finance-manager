import { createHash } from "node:crypto";
import { createDatabase, createPool, sql, type Database } from "@finance/db";
import { sendConfirmationEmail } from "@finance/auth";
import { vi, type Mock } from "vitest";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";

/**
 * Shared fixtures for the feature 002 auth specs.
 *
 * A spec file that uses `emailSpy()` must mock the module itself, because
 * `vi.mock` is hoisted per file and cannot live in a helper:
 *
 *   vi.mock("@finance/auth", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("@finance/auth")>()),
 *     sendConfirmationEmail: vi.fn(() => Promise.resolve()),
 *   }));
 */
export const appPool = createPool({
  connectionString: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/finance",
});
export const ownerPool = createPool({
  connectionString:
    process.env.DATABASE_URL_OWNER ?? "postgres://owner:owner@localhost:5432/finance",
});
export const appDb = createDatabase(appPool);
export const ownerDb = createDatabase(ownerPool);

export const PASSWORD = "correct horse battery";

export async function resetAuthTables(): Promise<void> {
  await ownerDb.execute(sql`truncate table "workspaces" cascade`);
  await ownerDb.execute(sql`delete from "auth_attempts"`);
  await ownerDb.execute(sql`delete from "audit_events"`);
  vi.mocked(sendConfirmationEmail).mockClear();
}

export function caller(
  db: Database = appDb,
  ip: string | null = "203.0.113.7",
): {
  caller: ReturnType<typeof appRouter.createCaller>;
  setSessionCookie: Mock;
  clearSessionCookie: Mock;
} {
  const setSessionCookie = vi.fn();
  const clearSessionCookie = vi.fn();
  const ctx: Context = { db, sessionToken: null, ip, setSessionCookie, clearSessionCookie };
  return { caller: appRouter.createCaller(ctx), setSessionCookie, clearSessionCookie };
}

/** Every email the code under test tried to send, in order. */
export function sentEmails(): { to: string; link: string; token: string }[] {
  return vi.mocked(sendConfirmationEmail).mock.calls.map(([to, link]) => ({
    to,
    link,
    token: new URL(link).searchParams.get("token") ?? "",
  }));
}

export function lastEmail(): { to: string; link: string; token: string } {
  const all = sentEmails();
  const last = all[all.length - 1];
  if (!last) throw new Error("no confirmation email was sent");
  return last;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function registerUnconfirmed(
  email: string,
): Promise<{ userId: string; workspaceId: string; token: string }> {
  const { caller: c } = caller();
  const { userId, workspaceId } = await c.auth.register({
    email,
    password: PASSWORD,
    displayName: "Person",
  });
  return { userId, workspaceId, token: lastEmail().token };
}

export async function scalar<T = string>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const result = await ownerDb.execute<Record<string, T>>(query);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

export async function closePools(): Promise<void> {
  await appPool.end();
  await ownerPool.end();
}
