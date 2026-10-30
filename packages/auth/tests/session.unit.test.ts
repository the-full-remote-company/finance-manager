import { describe, expect, it } from "vitest";
import {
  SESSION_TOKEN_BYTES,
  hashSessionToken,
  isExpired,
  issueSessionToken,
} from "../src/session.js";

/**
 * ADR 0003: an opaque 128-bit random session token, SHA-256 hashed at rest,
 * delivered in a __Host-session cookie.
 *
 * The raw token never reaches the database, so a database disclosure does not
 * yield usable sessions. That property is only true if the hashing is actually
 * one-way and the token actually random, so both are asserted here rather than
 * trusted.
 */
describe("session tokens", () => {
  it("is 128 bits of randomness", () => {
    expect(SESSION_TOKEN_BYTES).toBe(16);
  });

  it("issues a token and its hash, never storing the token itself", () => {
    const { token, tokenHash } = issueSessionToken();

    expect(token).not.toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The hash must not contain the token, or the "hashed at rest" claim is
    // decorative.
    expect(tokenHash).not.toContain(token);
  });

  it("produces a different token every time", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => issueSessionToken().token));
    expect(tokens.size).toBe(500);
  });

  it("hashes deterministically, so a presented token can be looked up", () => {
    const { token, tokenHash } = issueSessionToken();
    expect(hashSessionToken(token)).toBe(tokenHash);
  });

  it("uses a URL-safe encoding, since the token travels in a cookie", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(issueSessionToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  describe("expiry", () => {
    const now = new Date("2026-09-15T12:00:00Z");

    it("treats a future expiry as live and a past one as expired", () => {
      expect(isExpired({ expiresAt: new Date("2026-09-15T12:00:01Z"), revokedAt: null }, now)).toBe(
        false,
      );
      expect(isExpired({ expiresAt: new Date("2026-09-15T11:59:59Z"), revokedAt: null }, now)).toBe(
        true,
      );
    });

    it("treats the exact expiry instant as expired", () => {
      // A session that expires "now" is not still valid: the boundary belongs
      // on the safe side.
      expect(isExpired({ expiresAt: now, revokedAt: null }, now)).toBe(true);
    });

    it("treats a revoked session as expired regardless of its expiry", () => {
      // Story 1 scenario 3: "the session expires or is revoked".
      expect(
        isExpired(
          {
            expiresAt: new Date("2027-01-01T00:00:00Z"),
            revokedAt: new Date("2026-09-15T11:00:00Z"),
          },
          now,
        ),
      ).toBe(true);
    });
  });
});
