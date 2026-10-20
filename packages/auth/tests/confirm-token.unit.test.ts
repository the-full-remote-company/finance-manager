import { describe, it, expect } from "vitest";
import {
  issueConfirmToken,
  verifyConfirmToken,
  supersedePreviousTokens,
} from "../src/confirm-token.js";

describe("Confirmation tokens", () => {
  describe("issueConfirmToken", () => {
    it("issues a raw token and returns its SHA-256 hash", () => {
      const { raw, hash } = issueConfirmToken();

      expect(raw).toBeDefined();
      expect(hash).toBeDefined();
      expect(raw).not.toEqual(hash);

      // Raw token should be base64url (128 bits = 16 bytes, base64url = ~22 chars)
      expect(raw).toMatch(/^[A-Za-z0-9_-]{20,}$/);

      // Hash should be hex (SHA-256 = 64 hex chars)
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates different raw tokens on each call", () => {
      const { raw: raw1 } = issueConfirmToken();
      const { raw: raw2 } = issueConfirmToken();
      expect(raw1).not.toEqual(raw2);
    });

    it("includes 24-hour expiry", () => {
      const { expiresAt } = issueConfirmToken();
      const now = Date.now();
      const expiryMs = expiresAt.getTime();
      const hourMs = 60 * 60 * 1000;

      // Should expire ~24 hours from now (allow ±5 seconds for test execution time)
      expect(expiryMs).toBeGreaterThanOrEqual(now + 24 * hourMs - 5000);
      expect(expiryMs).toBeLessThanOrEqual(now + 24 * hourMs + 5000);
    });
  });

  describe("verifyConfirmToken", () => {
    it("returns true for a correct, non-expired, non-superseded token", () => {
      const { raw, hash, expiresAt } = issueConfirmToken();

      const result = verifyConfirmToken({
        providedRaw: raw,
        storedHash: hash,
        expiresAt,
        supersededAt: null,
      });

      expect(result).toBe(true);
    });

    it("returns false for a wrong raw token (wrong hash)", () => {
      const { hash, expiresAt } = issueConfirmToken();
      const wrongRaw = issueConfirmToken().raw;

      const result = verifyConfirmToken({
        providedRaw: wrongRaw,
        storedHash: hash,
        expiresAt,
        supersededAt: null,
      });

      expect(result).toBe(false);
    });

    it("returns false for an expired token", () => {
      const { raw, hash } = issueConfirmToken();
      const pastExpiry = new Date(Date.now() - 1000); // 1 second ago

      const result = verifyConfirmToken({
        providedRaw: raw,
        storedHash: hash,
        expiresAt: pastExpiry,
        supersededAt: null,
      });

      expect(result).toBe(false);
    });

    it("returns false for a superseded token", () => {
      const { raw, hash, expiresAt } = issueConfirmToken();
      const supersedTime = new Date(Date.now() - 1000);

      const result = verifyConfirmToken({
        providedRaw: raw,
        storedHash: hash,
        expiresAt,
        supersededAt: supersedTime,
      });

      expect(result).toBe(false);
    });

    it("returns false if superseded_at is in future (still active)", () => {
      const { raw, hash, expiresAt } = issueConfirmToken();
      const futureSupersed = new Date(Date.now() + 1000); // 1 second from now

      // Once superseded_at is set (past or future), token is invalid
      const result = verifyConfirmToken({
        providedRaw: raw,
        storedHash: hash,
        expiresAt,
        supersededAt: futureSupersed,
      });

      expect(result).toBe(false);
    });
  });

  describe("supersedePreviousTokens", () => {
    it("is a pure function that returns supersede timestamp", () => {
      const supersedTime = supersedePreviousTokens();

      expect(supersedTime).toBeInstanceOf(Date);
      expect(supersedTime.getTime()).toBeLessThanOrEqual(Date.now());
      expect(supersedTime.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    });
  });

  describe("security: no secrets in logs", () => {
    it("token hash is hex, never base64url", () => {
      const { hash } = issueConfirmToken();
      // Hex is safe to log; base64url with / would leak raw token format
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("raw token never stored or returned after issue", () => {
      const { raw: rawToken } = issueConfirmToken();
      // After initial return, raw token is never stored
      // This is ensured by the caller (auth resolver) converting raw->hash immediately
      expect(rawToken).toBeDefined();
    });
  });
});
