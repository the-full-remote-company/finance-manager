import { randomBytes, createHash } from "node:crypto";

/**
 * Confirmation token lifecycle (feature 002, ADR 0003).
 * Raw tokens are 128 bits of randomness, never stored.
 * Only the SHA-256 hash of the token is persisted in the database.
 */

const CONFIRM_TOKEN_BITS = 128;
const CONFIRM_TOKEN_BYTES = CONFIRM_TOKEN_BITS / 8;
const CONFIRM_TOKEN_VALIDITY_HOURS = 24;
const CONFIRM_TOKEN_VALIDITY_MS = CONFIRM_TOKEN_VALIDITY_HOURS * 60 * 60 * 1000;

/**
 * Generate a confirmation token.
 * @returns { raw: base64url token, hash: hex SHA-256, expiresAt: Date }
 *
 * The raw token is returned once to the caller and is never stored.
 * Only the hash is persisted, so a database read cannot yield a usable token.
 */
export function issueConfirmToken(): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(CONFIRM_TOKEN_BYTES).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_VALIDITY_MS);

  return { raw, hash, expiresAt };
}

/**
 * Verify a confirmation token.
 * @param providedRaw The raw token from the user (URL param)
 * @param storedHash The SHA-256 hash from database
 * @param expiresAt Expiry time from database
 * @param supersededAt If set (any value), token is invalid (resend invalidated it)
 * @returns true if token is valid, false otherwise
 *
 * A token is valid if:
 * 1. SHA-256(providedRaw) === storedHash
 * 2. expiresAt > now()
 * 3. supersededAt IS NULL
 */
export function verifyConfirmToken({
  providedRaw,
  storedHash,
  expiresAt,
  supersededAt,
}: {
  providedRaw: string;
  storedHash: string;
  expiresAt: Date;
  supersededAt: Date | null;
}): boolean {
  // Check if superseded (resend invalidated it)
  if (supersededAt !== null) {
    return false;
  }

  // Check if expired
  if (expiresAt < new Date()) {
    return false;
  }

  // Check if hash matches
  const providedHash = createHash("sha256").update(providedRaw).digest("hex");
  return providedHash === storedHash;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The value carried in the confirmation link: `<workspaceId>.<rawToken>`.
 *
 * The workspace id lets `auth.confirm` open a workspace-scoped transaction
 * before the lookup, so the lookup runs under ordinary row-level security
 * and no privileged (SECURITY DEFINER) function is needed. The id is not a
 * secret; `raw` is, and only its hash is stored or compared.
 */
export function composeConfirmToken(workspaceId: string, raw: string): string {
  return `${workspaceId}.${raw}`;
}

/**
 * Split a link value back into its parts. Returns `null` for anything that is
 * not exactly a lower-case UUID, a dot, and a non-empty base64url string; the
 * caller treats `null` exactly like an unknown token (`TOKEN_INVALID`).
 */
export function parseConfirmToken(value: string): { workspaceId: string; raw: string } | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [workspaceId, raw] = parts as [string, string];
  if (!UUID_PATTERN.test(workspaceId)) return null;
  if (!BASE64URL_PATTERN.test(raw)) return null;

  return { workspaceId, raw };
}

/**
 * Return the timestamp to set `superseded_at` on previous tokens.
 * Called when a resend is requested (invalidates all previous tokens for this user).
 */
export function supersedePreviousTokens(): Date {
  return new Date();
}
