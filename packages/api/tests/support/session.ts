import { sql, type Database } from "@finance/db";
import type { Context } from "../../src/context.js";
import { appRouter } from "../../src/router.js";

/**
 * Feature 002: `auth.register` no longer issues a session (FR-001), so a
 * fixture that needs a signed-in workspace must confirm the account first.
 *
 * The confirmation is done through the owner connection rather than by
 * extracting a token from the outbound email: these fixtures are not testing
 * the confirmation flow (the specs under `tests/auth/` do that), they only
 * need the account in its post-confirmation state. The session is then
 * obtained through the real `auth.signIn`, so it is a genuine session.
 */
export async function registerConfirmedWorkspace(
  appDb: Database,
  ownerDb: Database,
  email: string,
): Promise<{ token: string; workspaceId: string; userId: string }> {
  const password = "correct horse battery";
  let capturedToken: string | undefined;
  const ctx: Context = {
    db: appDb,
    sessionToken: null,
    ip: "203.0.113.7",
    setSessionCookie: (token) => {
      capturedToken = token;
    },
  };
  const caller = appRouter.createCaller(ctx);

  const { userId, workspaceId } = await caller.auth.register({
    email,
    password,
    displayName: "Tester",
  });

  await ownerDb.execute(
    sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${userId}`,
  );

  await caller.auth.signIn({ email, password });
  if (!capturedToken) throw new Error("no session token captured");
  return { token: capturedToken, workspaceId, userId };
}
