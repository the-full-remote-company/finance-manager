import { describe, expect, it } from "vitest";
import { issueConfirmToken } from "../src/confirm-token.js";
import { composeConfirmToken, parseConfirmToken } from "../src/confirm-token.js";

/**
 * The link carries `<workspaceId>.<rawToken>`, so `auth.confirm` can open a
 * workspace-scoped transaction before it looks the token up, and the lookup
 * runs under ordinary row-level security. That avoids adding a third
 * SECURITY DEFINER function to the auth path.
 *
 * The workspace id is not a secret. The secret is `raw`, and only the hash of
 * `raw` is stored and compared.
 */
const WORKSPACE_ID = "0b6f1a52-8c3e-4a55-9d1f-3f1d2a7c9e10";

describe("composeConfirmToken / parseConfirmToken", () => {
  it("round-trips a workspace id and a raw token", () => {
    const { raw } = issueConfirmToken();
    const composed = composeConfirmToken(WORKSPACE_ID, raw);

    expect(parseConfirmToken(composed)).toEqual({ workspaceId: WORKSPACE_ID, raw });
  });

  it("produces a value that is safe in a URL query without encoding", () => {
    const { raw } = issueConfirmToken();
    const composed = composeConfirmToken(WORKSPACE_ID, raw);

    expect(composed).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(composed)).toBe(composed);
  });

  it("rejects a bare token with no workspace prefix", () => {
    const { raw } = issueConfirmToken();
    expect(parseConfirmToken(raw)).toBeNull();
  });

  it("rejects a prefix that is not a UUID", () => {
    expect(parseConfirmToken("not-a-uuid.abcdefghijklmnopqrstuv")).toBeNull();
    expect(parseConfirmToken("'; drop table users;--.abcdefghijklmnopqrstuv")).toBeNull();
  });

  it("rejects an empty raw part", () => {
    expect(parseConfirmToken(`${WORKSPACE_ID}.`)).toBeNull();
  });

  it("rejects a raw part outside the base64url alphabet", () => {
    expect(parseConfirmToken(`${WORKSPACE_ID}.abc def`)).toBeNull();
    expect(parseConfirmToken(`${WORKSPACE_ID}.abc.def`)).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseConfirmToken("")).toBeNull();
  });

  it("does not throw on arbitrary input", () => {
    for (const value of ["\u0000", ".", "..", "a.b.c", " ", "\n", "🙂.🙂"]) {
      expect(() => parseConfirmToken(value)).not.toThrow();
      expect(parseConfirmToken(value)).toBeNull();
    }
  });
});
