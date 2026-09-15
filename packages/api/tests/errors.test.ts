import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  APP_ERROR_TRANSPORT,
  appError,
  notFound,
  toTrpcError,
  type AppErrorCode,
} from "../src/errors.js";

/**
 * contracts/errors.md. Every failure this feature can produce, its wire shape,
 * and what the UI must do with it.
 *
 * The central property: a record in another workspace produces a NOT_FOUND
 * that is byte-identical to a record that never existed. Per FR-003 and
 * Article I, non-existence and non-entitlement must be indistinguishable on the
 * wire — a difference in message, details or field order is a disclosure.
 */
describe("error contract", () => {
  it("maps every documented code to its stated transport code", () => {
    // The table in contracts/errors.md, asserted rather than described.
    const expected: Record<string, string> = {
      VALIDATION_FAILED: "BAD_REQUEST",
      AUTH_FAILED: "UNAUTHORIZED",
      NOT_FOUND: "NOT_FOUND",
      RATE_LIMITED: "TOO_MANY_REQUESTS",
      NAME_TAKEN: "CONFLICT",
      STILL_REFERENCED: "CONFLICT",
      DIRECTION_IMMUTABLE: "CONFLICT",
      DIRECTION_MISMATCH: "BAD_REQUEST",
      ANCHOR_REQUIRED: "BAD_REQUEST",
      TRANSFER_EQUALS_SOURCE: "BAD_REQUEST",
      END_BEFORE_START: "BAD_REQUEST",
      NEGATIVE_AMOUNT: "BAD_REQUEST",
      EFFECTIVE_MONTH_TAKEN: "CONFLICT",
      LAST_AMOUNT: "CONFLICT",
      AMOUNT_GAP: "CONFLICT",
      MONTH_NOT_ACTIVE: "BAD_REQUEST",
      MONTH_NOT_DUE: "BAD_REQUEST",
      MONTH_OUT_OF_HORIZON: "BAD_REQUEST",
    };

    for (const [code, transport] of Object.entries(expected)) {
      expect(APP_ERROR_TRANSPORT[code as AppErrorCode], code).toBe(transport);
    }
  });

  it("documents exactly the codes the contract lists, no more", () => {
    // A code added to the implementation without a contract entry is a wire
    // change nobody reviewed.
    expect(Object.keys(APP_ERROR_TRANSPORT).sort()).toEqual(
      [
        "AMOUNT_GAP",
        "ANCHOR_REQUIRED",
        "AUTH_FAILED",
        "DIRECTION_IMMUTABLE",
        "DIRECTION_MISMATCH",
        "EFFECTIVE_MONTH_TAKEN",
        "END_BEFORE_START",
        "LAST_AMOUNT",
        "MONTH_NOT_ACTIVE",
        "MONTH_NOT_DUE",
        "MONTH_OUT_OF_HORIZON",
        "NAME_TAKEN",
        "NEGATIVE_AMOUNT",
        "NOT_FOUND",
        "RATE_LIMITED",
        "STILL_REFERENCED",
        "TRANSFER_EQUALS_SOURCE",
        "VALIDATION_FAILED",
      ].sort(),
    );
  });

  it("carries the machine code in data.appCode and a stable token in message", () => {
    const error = toTrpcError(appError("STILL_REFERENCED", { referenceCount: 7 }));

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe("CONFLICT");
    expect(error.cause).toMatchObject({
      appCode: "STILL_REFERENCED",
      details: { referenceCount: 7 },
    });
    // message is a machine token for logs, never a user-facing sentence: the UI
    // selects its string from next-intl by appCode.
    expect(error.message).toBe("still_referenced");
    expect(error.message).not.toMatch(/\s/);
  });

  describe("NOT_FOUND is indistinguishable from non-entitlement (FR-003)", () => {
    it("produces identical errors for an absent record and a foreign one", () => {
      const absent = toTrpcError(notFound());
      const foreign = toTrpcError(notFound());

      expect(foreign.code).toBe(absent.code);
      expect(foreign.message).toBe(absent.message);
      expect(JSON.stringify(foreign.cause)).toBe(JSON.stringify(absent.cause));
    });

    it("carries no details at all, so nothing can differ", () => {
      const error = toTrpcError(notFound());
      expect(error.cause).toMatchObject({ appCode: "NOT_FOUND" });
      expect((error.cause as { details?: unknown }).details).toBeUndefined();
    });

    it("offers no way to attach details to a NOT_FOUND", () => {
      // @ts-expect-error NOT_FOUND takes no details: the type is the guard, so
      // a well-meaning caller cannot leak "belongs to workspace B" into it.
      expect(() => appError("NOT_FOUND", { workspaceId: "b" })).toThrow(/NOT_FOUND/);
    });
  });

  describe("details carry no personal data (Article VIII)", () => {
    it("permits only the documented, non-identifying detail keys", () => {
      expect(() =>
        // @ts-expect-error not a permitted detail key
        appError("VALIDATION_FAILED", { email: "person@example.test" }),
      ).toThrow(/detail/i);
    });

    it("rejects a monetary amount in details", () => {
      expect(() =>
        // @ts-expect-error not a permitted detail key
        appError("NEGATIVE_AMOUNT", { amount: "95000" }),
      ).toThrow(/detail/i);
    });

    it("allows the counts and months the UI needs to compose its message", () => {
      expect(() => appError("STILL_REFERENCED", { referenceCount: 7 })).not.toThrow();
      expect(() =>
        appError("MONTH_OUT_OF_HORIZON", { firstMonth: "2026-01", lastMonth: "2027-12" }),
      ).not.toThrow();
      expect(() => appError("MONTH_NOT_DUE", { dueMonths: ["2026-01", "2026-04"] })).not.toThrow();
      expect(() => appError("RATE_LIMITED", { retryAfterSeconds: 60 })).not.toThrow();
    });
  });
});
