import { parseOptions } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { ARGON2ID_PARAMETERS, hashPassword, verifyPassword } from "../src/password.js";

/**
 * ADR 0003 pins the argon2id parameters: memoryCost 19456 KiB, timeCost 2,
 * parallelism 1 — the OWASP Password Storage Cheat Sheet's second listed
 * configuration. They are pinned in an ADR so a future change is a visible
 * decision rather than a quiet edit.
 *
 * "Password hashing MUST be argon2id" is stated by the constitution's approved
 * stack, so the algorithm is asserted from the encoded hash rather than
 * assumed from the call site.
 */
describe("password hashing", () => {
  it("uses the argon2id parameters recorded in ADR 0003", () => {
    expect(ARGON2ID_PARAMETERS).toEqual({
      // 2 is Algorithm.Argon2id. The enum is ambient-const and cannot be
      // imported under verbatimModuleSyntax, so the algorithm is proved from
      // the encoded hash in the next test rather than from this constant.
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it("produces an argon2id hash carrying those parameters", async () => {
    const hash = await hashPassword("korrekt-pferd-batterie-heftklammer");

    // $argon2id$v=19$m=19456,t=2,p=1$...
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const parsed = parseOptions(hash);
    expect(parsed.memoryCost).toBe(19456);
    expect(parsed.timeCost).toBe(2);
    expect(parsed.parallelism).toBe(1);
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("korrekt-pferd-batterie-heftklammer");

    await expect(verifyPassword(hash, "korrekt-pferd-batterie-heftklammer")).resolves.toBe(true);
    await expect(verifyPassword(hash, "korrekt-pferd-batterie-heftklammeR")).resolves.toBe(false);
    await expect(verifyPassword(hash, "")).resolves.toBe(false);
  });

  it("salts: the same password hashes differently every time", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
    await expect(verifyPassword(first, "same-password")).resolves.toBe(true);
    await expect(verifyPassword(second, "same-password")).resolves.toBe(true);
  });

  it("returns false rather than throwing on a malformed stored hash", async () => {
    // A corrupt row must fail the sign-in, not crash the endpoint and leak a
    // stack trace describing the hash format.
    await expect(verifyPassword("not-a-hash", "whatever")).resolves.toBe(false);
  });

  it("rejects an empty password at registration", async () => {
    await expect(hashPassword("")).rejects.toThrow(/password/i);
  });
});
