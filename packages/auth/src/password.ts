import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id, per the constitution's approved stack ("Password hashing MUST be
 * argon2id") with the parameters pinned in ADR 0003: the OWASP Password
 * Storage Cheat Sheet's second listed configuration.
 *
 * `Algorithm.Argon2id` is not imported. @node-rs/argon2 declares Algorithm as
 * an ambient `const enum`, which `verbatimModuleSyntax` forbids accessing —
 * the value would have to be inlined at compile time from a declaration file
 * that carries no runtime counterpart. The numeric value is written out
 * instead, and the choice is verified where it actually matters: the test
 * parses the encoded hash and asserts it begins with `$argon2id$`. A constant
 * named correctly proves nothing; the encoded prefix is the real evidence.
 */
const ARGON2ID = 2; // Algorithm.Argon2id

export const ARGON2ID_PARAMETERS = {
  algorithm: ARGON2ID,
  /** 19 MiB. */
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) {
    throw new Error("password must not be empty");
  }
  return hash(password, ARGON2ID_PARAMETERS);
}

/**
 * Returns false rather than throwing on a malformed stored hash. A corrupt row
 * must fail the sign-in like any wrong password: throwing would turn it into a
 * 500 carrying a stack trace that describes the hash format, and would
 * distinguish "corrupt row" from "wrong password" to an attacker.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2ID_PARAMETERS);
  } catch {
    return false;
  }
}
