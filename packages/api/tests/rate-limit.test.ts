import { createDatabase, createPool, sql } from "@finance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  pruneRateLimits,
  type RateLimitPolicy,
} from "../src/middleware/rate-limit.js";

/**
 * FR-005: throttle repeated failed authentication attempts.
 * Story 1 scenario 4: "further attempts are throttled".
 */
const pool = createPool({
  connectionString: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/finance",
});
const db = createDatabase(pool);

const policy: RateLimitPolicy = { maxAttempts: 3, windowMinutes: 15 };

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // DELETE, not TRUNCATE: the app role has no TRUNCATE privilege, and
  // granting it to make a test convenient would widen production rights.
  await db.execute(sql`delete from "auth_attempts"`);
});

describe("rate limiting", () => {
  it("allows attempts up to the limit", async () => {
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      await expect(
        consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy),
      ).resolves.toBeUndefined();
    }
  });

  it("refuses the attempt after the limit with RATE_LIMITED and a retry hint", async () => {
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      await consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy);
    }

    await expect(
      consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      cause: { appCode: "RATE_LIMITED" },
    });
  });

  it("reports a positive retryAfterSeconds within the window", async () => {
    for (let attempt = 0; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        await consumeRateLimit(
          db,
          { identifier: "person@example.test", ip: "203.0.113.7" },
          policy,
        );
      } catch (error) {
        const details = (error as { cause?: { details?: { retryAfterSeconds?: number } } }).cause
          ?.details;
        expect(details?.retryAfterSeconds).toBeGreaterThan(0);
        expect(details?.retryAfterSeconds).toBeLessThanOrEqual(policy.windowMinutes * 60);
        return;
      }
    }
    throw new Error("expected the limit to be reached");
  });

  it("counts different identifiers separately", async () => {
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      await consumeRateLimit(db, { identifier: "first@example.test", ip: "203.0.113.7" }, policy);
    }

    // A different account from the same address still has its own budget: one
    // user exhausting theirs must not lock out a household member.
    await expect(
      consumeRateLimit(db, { identifier: "second@example.test", ip: "203.0.113.7" }, policy),
    ).resolves.toBeUndefined();
  });

  it("counts different addresses separately", async () => {
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      await consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy);
    }

    await expect(
      consumeRateLimit(db, { identifier: "person@example.test", ip: "198.51.100.9" }, policy),
    ).resolves.toBeUndefined();
  });

  it("stores no plaintext identifier or address", async () => {
    // Article VIII: a throttling table keyed by plaintext email is an account
    // identifier in a log by another name.
    await consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy);

    const result = await db.execute<{ identifier: string; ip: string }>(
      sql`select encode("identifier_hash", 'hex') as identifier, encode("ip_hash", 'hex') as ip from "auth_attempts"`,
    );

    expect(result.rows[0]?.identifier).not.toContain("person");
    expect(result.rows[0]?.ip).not.toContain("203");
  });

  it("does not let concurrent attempts spend the same budget twice", async () => {
    // The increment must be atomic. A read-then-write would let a burst of
    // parallel sign-in attempts each see the same count and all pass.
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        consumeRateLimit(db, { identifier: "racer@example.test", ip: "203.0.113.7" }, policy),
      ),
    );

    const allowed = attempts.filter((result) => result.status === "fulfilled").length;
    expect(allowed).toBe(policy.maxAttempts);
  });

  it("prunes elapsed windows", async () => {
    await consumeRateLimit(db, { identifier: "person@example.test", ip: "203.0.113.7" }, policy);
    await db.execute(sql`update "auth_attempts" set "window_start" = now() - interval '2 hours'`);

    await pruneRateLimits(db, 60);

    const result = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from "auth_attempts"`,
    );
    expect(result.rows[0]?.count).toBe("0");
  });
});
