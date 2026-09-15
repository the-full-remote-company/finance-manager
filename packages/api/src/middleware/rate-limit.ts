import { hashIp } from "@finance/auth";
import { sql, type Database } from "@finance/db";
import { appError, toTrpcError } from "../errors.js";

/**
 * Rate limiting, per "Baseline security controls": required on authentication
 * and on all mutating endpoints, and by FR-005 for repeated failed sign-ins.
 *
 * A fixed window in `auth_attempts`, which is not tenant-scoped because it is
 * consulted before any workspace is known.
 *
 * The key is hashed. Article VIII forbids writing an account identifier to a
 * log, and a throttling table keyed by plaintext email is exactly that with a
 * different name.
 */

export interface RateLimitPolicy {
  readonly maxAttempts: number;
  readonly windowMinutes: number;
}

export const AUTH_RATE_LIMIT: RateLimitPolicy = {
  maxAttempts: Number(process.env.AUTH_MAX_ATTEMPTS ?? 10),
  windowMinutes: Number(process.env.AUTH_WINDOW_MINUTES ?? 15),
};

/** Mutations are limited more loosely than sign-in: the risk is abuse, not credential stuffing. */
export const MUTATION_RATE_LIMIT: RateLimitPolicy = { maxAttempts: 120, windowMinutes: 1 };

export interface RateLimitKey {
  /** What is being limited: an email for sign-in, a procedure path for a mutation. */
  readonly identifier: string;
  readonly ip: string | null;
}

/**
 * Consumes one unit of budget. Throws RATE_LIMITED with retryAfterSeconds when
 * the window is exhausted.
 *
 * The count is incremented before the decision so that a caller cannot spend a
 * whole window by racing: the UPDATE ... RETURNING is atomic, and a burst of
 * concurrent requests each observes a distinct post-increment value.
 */
export async function consumeRateLimit(
  db: Database,
  key: RateLimitKey,
  policy: RateLimitPolicy,
): Promise<void> {
  const identifierHash = hashIp(key.identifier);
  const ipHash = hashIp(key.ip ?? "unknown");
  const windowMinutes = policy.windowMinutes;

  const result = await db.execute<{ attempts: number; window_start: string | Date }>(
    sql`
      insert into "auth_attempts" ("identifier_hash", "ip_hash", "window_start", "attempts")
      values (
        ${identifierHash},
        ${ipHash},
        date_trunc('minute', now()) - make_interval(mins => (extract(minute from now())::int % ${windowMinutes})),
        1
      )
      on conflict ("identifier_hash", "ip_hash", "window_start")
        do update set "attempts" = "auth_attempts"."attempts" + 1
      returning "attempts", "window_start"
    `,
  );

  const row = result.rows[0];
  if (!row) return;

  if (row.attempts > policy.maxAttempts) {
    const windowStart =
      row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
    const resetAt = windowStart.getTime() + policy.windowMinutes * 60_000;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

    throw toTrpcError(appError("RATE_LIMITED", { retryAfterSeconds }));
  }
}

/** Removes windows that have fully elapsed. Called opportunistically, not on a schedule. */
export async function pruneRateLimits(db: Database, olderThanMinutes = 60): Promise<void> {
  await db.execute(
    sql`delete from "auth_attempts" where "window_start" < now() - make_interval(mins => ${olderThanMinutes})`,
  );
}
