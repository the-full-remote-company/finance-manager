import { sendConfirmationEmail } from "@finance/auth";
import { sql } from "@finance/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  caller,
  closePools,
  ownerDb,
  registerUnconfirmed,
  resetAuthTables,
} from "../support/confirmation.js";

/**
 * Real SMTP takes tens to thousands of milliseconds. The mock reproduces that
 * delay, because a mailer that answers instantly would hide the one thing
 * that can make an unconfirmed address distinguishable from an unknown one.
 */
const SEND_LATENCY_MS = 150;

vi.mock("@finance/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@finance/auth")>()),
  sendConfirmationEmail: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 150))),
}));

/**
 * T024 — feature 002, FR-009, ADR 0003: "the caller has no way to distinguish
 * the three cases from the response or its timing".
 *
 * Samples are interleaved round-robin so drift (GC, pool warm-up, a noisy
 * neighbour) lands on every kind equally, and each sample uses its own source
 * address so the throttle never changes the work being measured. Medians, not
 * means: one slow outlier must not decide the verdict.
 *
 * The tolerance is set far below SEND_LATENCY_MS, so awaiting the send inside
 * the request cannot pass, and above the few milliseconds of database work a
 * real resend does and a no-op does not.
 */
const SAMPLES_PER_KIND = 15;
const WARMUP_ROUNDS = 3;
const TOLERANCE_MS = 40;

type Kind = "unconfirmed" | "confirmed" | "unknown";
const KINDS: readonly Kind[] = ["unconfirmed", "confirmed", "unknown"];

const ADDRESS: Record<Kind, string> = {
  unconfirmed: "unconfirmed@example.test",
  confirmed: "confirmed@example.test",
  unknown: "unknown@example.test",
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

afterAll(closePools);

describe("auth.resendConfirmation — timing class (T024)", () => {
  const samples: Record<Kind, number[]> = { unconfirmed: [], confirmed: [], unknown: [] };
  let mailerCalls = 0;

  beforeAll(async () => {
    await resetAuthTables();
    await registerUnconfirmed(ADDRESS.unconfirmed);
    const confirmed = await registerUnconfirmed(ADDRESS.confirmed);
    await ownerDb.execute(
      sql`update "users" set "confirmed" = true, "confirmed_at" = now() where "id" = ${confirmed.userId}`,
    );

    for (let round = 0; round < WARMUP_ROUNDS + SAMPLES_PER_KIND; round += 1) {
      for (const kind of KINDS) {
        // A distinct address per call keeps every sample out of the throttle.
        const { caller: c } = caller(
          undefined,
          `198.51.100.${String(round * 3 + KINDS.indexOf(kind) + 1)}`,
        );
        const start = performance.now();
        await c.auth.resendConfirmation({ email: ADDRESS[kind] });
        const elapsed = performance.now() - start;
        if (round >= WARMUP_ROUNDS) samples[kind].push(elapsed);
      }
    }
    mailerCalls = vi.mocked(sendConfirmationEmail).mock.calls.length;
  }, 120_000);

  it("a mailer with realistic latency does not make an unconfirmed address slower to answer", () => {
    const m = Object.fromEntries(KINDS.map((k) => [k, median(samples[k])])) as Record<Kind, number>;
    const summary = `medians ms: unconfirmed=${m.unconfirmed.toFixed(1)} confirmed=${m.confirmed.toFixed(1)} unknown=${m.unknown.toFixed(1)}`;

    expect(Math.abs(m.unconfirmed - m.unknown), summary).toBeLessThanOrEqual(TOLERANCE_MS);
    expect(Math.abs(m.unconfirmed - m.confirmed), summary).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it("a confirmed address and an unknown one are in the same class", () => {
    const confirmed = median(samples.confirmed);
    const unknown = median(samples.unknown);
    expect(
      Math.abs(confirmed - unknown),
      `medians ms: confirmed=${confirmed.toFixed(1)} unknown=${unknown.toFixed(1)}`,
    ).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it("really did simulate a slow mailer for the unconfirmed address", () => {
    // Guards the test against going vacuous: the mock was called, and with the
    // delay that makes awaiting it detectable.
    expect(mailerCalls).toBeGreaterThanOrEqual(SAMPLES_PER_KIND);
    expect(SEND_LATENCY_MS).toBeGreaterThan(TOLERANCE_MS * 2);
  });
});
