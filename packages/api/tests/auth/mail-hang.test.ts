import { createServer, type Server, type Socket } from "node:net";
import { sql } from "@finance/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, caller, closePools, resetAuthTables, scalar } from "../support/confirmation.js";

/**
 * T042 / FR-017 / FR-009 — a mail provider that accepts the connection and
 * then never speaks, which is what a hung provider looks like. The real mailer
 * would wait out its 8 s greeting timeout; neither registration nor resend may
 * wait with it, or a slow mailbox server would show through response time.
 */
const MUST_ANSWER_WITHIN_MS = 2000;

let server: Server;
const sockets = new Set<Socket>();

beforeAll(async () => {
  server = createServer((socket) => {
    sockets.add(socket); // accept, say nothing
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", String(port));
  vi.stubEnv("SMTP_FROM", "noreply@example.test");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_PASS", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await closePools();
});

beforeEach(resetAuthTables);

describe("a hung mail provider does not slow the request (T042)", () => {
  it("registration answers promptly and the account is usable", async () => {
    const start = performance.now();
    const result = await caller().caller.auth.register({
      email: "alice@example.test",
      password: PASSWORD,
      displayName: "Alice",
    });
    const elapsed = performance.now() - start;

    expect(elapsed, `took ${elapsed.toFixed(0)} ms`).toBeLessThan(MUST_ANSWER_WITHIN_MS);
    // Not vacuous: the send really is in flight against the hung server. It starts
    // after the response, so wait for the connection rather than assume it.
    await vi.waitFor(() => {
      expect(sockets.size, "the mailer never connected to the hung server").toBeGreaterThan(0);
    });
    expect(
      await scalar(sql`select "confirmed"::text from "users" where "id" = ${result.userId}`),
    ).toBe("false");
  });

  it("resend answers promptly too", async () => {
    await caller().caller.auth.register({
      email: "bob@example.test",
      password: PASSWORD,
      displayName: "Bob",
    });

    const start = performance.now();
    await caller().caller.auth.resendConfirmation({ email: "bob@example.test" });
    const elapsed = performance.now() - start;

    expect(elapsed, `took ${elapsed.toFixed(0)} ms`).toBeLessThan(MUST_ANSWER_WITHIN_MS);
  });
});
