import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque session tokens, per ADR 0003.
 *
 * 128 bits of randomness, SHA-256 hashed at rest. The raw token never reaches
 * the database, so a database disclosure yields no usable session.
 *
 * SHA-256 rather than argon2id here, deliberately: this value is high-entropy
 * random, not a low-entropy human password, so there is nothing to brute-force
 * and a slow KDF would only add latency to every authenticated request.
 */
export const SESSION_TOKEN_BYTES = 16;

export interface IssuedSessionToken {
  /** Sent to the client in the __Host-session cookie. Never persisted. */
  readonly token: string;
  /** Persisted. Never sent. */
  readonly tokenHash: string;
}

export function issueSessionToken(): IssuedSessionToken {
  // base64url: cookie-safe without escaping.
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * The lookup is by hash and therefore indexed, but where a comparison is made
 * in application code it must not leak position through timing.
 */
export function tokenHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SessionLifetime {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * FR-004 and Story 1 scenario 3: an expired *or revoked* session reaches no
 * workspace data.
 *
 * The exact expiry instant counts as expired — the boundary belongs on the
 * safe side.
 */
export function isExpired(session: SessionLifetime, now: Date = new Date()): boolean {
  if (session.revokedAt !== null) return true;
  return session.expiresAt.getTime() <= now.getTime();
}
