import { describe, expect, it } from "vitest";
import { appRouter } from "../src/router.js";

/**
 * FR-004: every procedure requires a session except the ones named here.
 *
 * tasks.md's T065 names four — `auth.register`, `auth.signIn`, `auth.signOut`,
 * `health.ping` — but contracts/procedures.md's own text for `auth.session`
 * requires the fifth: "Returns null rather than erroring when unauthenticated,
 * so the client can decide between a sign-in screen and a redirect without
 * treating the absence of a session as a failure." That is impossible through
 * `protectedProcedure`, which throws `AUTH_FAILED` on a missing session by
 * design. The contract is the authority where the two disagree; the fifth
 * entry is deliberate, not a slip.
 *
 * Feature 002 adds two more, for the same reason `auth.register` is exempt:
 * `auth.confirm` and `auth.resendConfirmation` are called by someone who, by
 * definition, has no session yet — `auth.confirm` is how they obtain one.
 *
 * `_def.type` distinguishes query/mutation but not which middleware a
 * procedure carries, so this reads the middleware stack length instead:
 * `protectedProcedure` always carries at least the session-resolving
 * middleware `publicProcedure` does not.
 */
const EXEMPT = new Set([
  "auth.register",
  "auth.confirm",
  "auth.resendConfirmation",
  "auth.signIn",
  "auth.signOut",
  "auth.session",
  "health.ping",
]);

function proceduresOf(): { path: string; middlewareCount: number }[] {
  const entries: { path: string; middlewareCount: number }[] = [];
  for (const [path, procedure] of Object.entries(appRouter._def.procedures)) {
    const middlewares = (procedure as unknown as { _def: { middlewares: unknown[] } })._def
      .middlewares;
    entries.push({ path, middlewareCount: middlewares.length });
  }
  return entries;
}

describe("exempt procedures (FR-004)", () => {
  it("every procedure not in the exempt set carries protectedProcedure's middleware", () => {
    const publicMiddlewareCount =
      proceduresOf().find((entry) => entry.path === "health.ping")?.middlewareCount ?? 0;

    const wronglyPublic = proceduresOf()
      .filter((entry) => !EXEMPT.has(entry.path))
      .filter((entry) => entry.middlewareCount <= publicMiddlewareCount)
      .map((entry) => entry.path);

    expect(
      wronglyPublic,
      "these procedures are reachable without a session and are not in the documented exempt set",
    ).toEqual([]);
  });

  it("every procedure in the exempt set actually exists in the router", () => {
    const paths = new Set(proceduresOf().map((entry) => entry.path));
    for (const path of EXEMPT) {
      expect(paths.has(path), `${path} is in the exempt set but not mounted`).toBe(true);
    }
  });

  it("the exempt set is exactly these seven, no more", () => {
    expect([...EXEMPT].sort()).toEqual(
      [
        "auth.confirm",
        "auth.register",
        "auth.resendConfirmation",
        "auth.session",
        "auth.signIn",
        "auth.signOut",
        "health.ping",
      ].sort(),
    );
  });
});
