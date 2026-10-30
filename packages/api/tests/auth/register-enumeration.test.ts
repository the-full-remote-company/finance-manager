import { sendConfirmationEmail } from "@finance/auth";
import { sql } from "@finance/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  caller,
  closePools,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
  scalar,
} from "../support/confirmation.js";

/**
 * Real SMTP takes tens to thousands of milliseconds. The mock reproduces that
 * delay, because a mailer that answers instantly would hide the one thing that
 * can make a genuine registration slower than a duplicate.
 */
const SEND_LATENCY_MS = 150;

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 150))),
}));

/**
 * T029 — feature 002, FR-011, ADR 0003.
 * Registering a new address, a confirmed one and an unconfirmed one must look
 * the same: same response shape, no session, and the same timing class. The
 * password is hashed before the collision is known, so argon2id dominates
 * every call; what must not appear on top of it is anything that only a
 * genuine registration does, above all waiting on the mail server.
 *
 * Samples are interleaved round-robin so drift lands on every kind equally,
 * each uses its own source address so the throttle never changes the work
 * measured, and medians decide, so one slow outlier cannot.
 *
 * The tolerance is far below SEND_LATENCY_MS (awaiting the send cannot pass)
 * and above argon2id's own run-to-run variance. It detects an SMTP-class
 * difference, not a millisecond one; see ADR 0011 for what remains.
 */
const SAMPLES_PER_KIND = 12;
const WARMUP_ROUNDS = 2;
const TOLERANCE_MS = 40;

type Kind = "new" | "confirmed" | "unconfirmed";
const KINDS: readonly Kind[] = ["new", "confirmed", "unconfirmed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

afterAll(closePools);

describe("auth.register — what a caller can see (T029)", () => {
  beforeAll(resetAuthTables);

  it("a new, a confirmed and an unconfirmed address all answer with the same shape", async () => {
    const confirmed = await registerUnconfirmed("confirmed-shape@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${confirmed.userId}`,
    );
    await registerUnconfirmed("unconfirmed-shape@example.test");

    const answers = [];
    for (const [i, email] of [
      "brand-new-shape@example.test",
      "confirmed-shape@example.test",
      "unconfirmed-shape@example.test",
    ].entries()) {
      const { caller: c } = caller(undefined, `192.0.2.${String(i + 1)}`);
      answers.push(await c.auth.register({ email, password: PASSWORD, displayName: "Shape" }));
    }

    for (const answer of answers) {
      expect(Object.keys(answer)).toEqual(["userId", "workspaceId"]);
      expect(answer.userId).toMatch(UUID);
      expect(answer.workspaceId).toMatch(UUID);
    }
    expect(Object.keys(answers[1] ?? {})).toEqual(Object.keys(answers[0] ?? {}));
    expect(Object.keys(answers[2] ?? {})).toEqual(Object.keys(answers[0] ?? {}));
  });

  it("a duplicate sets no session cookie and creates no session", async () => {
    await registerUnconfirmed("dup-session@example.test");
    const sessionsBefore = await scalar(sql`select count(*)::text from "sessions"`);

    const { caller: c, setSessionCookie } = caller(undefined, "192.0.2.50");
    await c.auth.register({
      email: "dup-session@example.test",
      password: PASSWORD,
      displayName: "Dup",
    });

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(await scalar(sql`select count(*)::text from "sessions"`)).toBe(sessionsBefore);
  });
});

describe("auth.register — timing class (T029, FR-011)", () => {
  const samples: Record<Kind, number[]> = { new: [], confirmed: [], unconfirmed: [] };
  let mailerCalls = 0;

  beforeAll(async () => {
    await resetAuthTables();
    const confirmed = await registerUnconfirmed("confirmed-timing@example.test");
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${confirmed.userId}`,
    );
    await registerUnconfirmed("unconfirmed-timing@example.test");

    for (let round = 0; round < WARMUP_ROUNDS + SAMPLES_PER_KIND; round += 1) {
      for (const kind of KINDS) {
        const email =
          kind === "new" ? `fresh-${String(round)}@example.test` : `${kind}-timing@example.test`;
        // A distinct source address per call keeps every sample out of the throttle.
        const { caller: c } = caller(
          undefined,
          `198.51.100.${String(round * 3 + KINDS.indexOf(kind) + 1)}`,
        );
        const start = performance.now();
        await c.auth.register({ email, password: PASSWORD, displayName: "Timing" });
        const elapsed = performance.now() - start;
        if (round >= WARMUP_ROUNDS) samples[kind].push(elapsed);
      }
    }
    mailerCalls = vi.mocked(sendConfirmationEmail).mock.calls.length;
  }, 180_000);

  const medians = () =>
    Object.fromEntries(KINDS.map((k) => [k, median(samples[k])])) as Record<Kind, number>;
  const describeMedians = (m: Record<Kind, number>) =>
    `medians ms: new=${m.new.toFixed(1)} confirmed=${m.confirmed.toFixed(1)} unconfirmed=${m.unconfirmed.toFixed(1)}`;

  it("a genuine registration is not slower to answer than a duplicate of a confirmed address", () => {
    const m = medians();
    expect(Math.abs(m.new - m.confirmed), describeMedians(m)).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it("a genuine registration is not slower to answer than a duplicate of an unconfirmed address", () => {
    const m = medians();
    expect(Math.abs(m.new - m.unconfirmed), describeMedians(m)).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it("really did simulate a slow mailer for the genuine registrations", () => {
    // Guards the test against going vacuous.
    expect(mailerCalls).toBeGreaterThanOrEqual(SAMPLES_PER_KIND);
    expect(SEND_LATENCY_MS).toBeGreaterThan(TOLERANCE_MS * 2);
  });
});
