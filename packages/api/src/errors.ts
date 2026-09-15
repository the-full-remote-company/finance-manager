import { TRPCError } from "@trpc/server";

/**
 * The error contract from contracts/errors.md, in code.
 *
 * Two properties this file exists to guarantee:
 *
 *  1. A NOT_FOUND for a record in another workspace is byte-identical to a
 *     NOT_FOUND for a record that never existed (FR-003, Article I). The type
 *     gives NOT_FOUND no details parameter at all, so there is nothing that
 *     could differ between the two cases.
 *
 *  2. `details` carries only non-identifying values (Article VIII). The
 *     permitted keys are an allow-list, enforced at construction, so a
 *     well-meaning caller cannot widen the payload with an email address or a
 *     monetary amount.
 *
 * `message` is a stable machine token for logs, never a user-facing sentence:
 * the UI selects its string from next-intl by appCode, and a server-authored
 * sentence could not be translated or lint-enforced.
 */

export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NAME_TAKEN"
  | "STILL_REFERENCED"
  | "DIRECTION_IMMUTABLE"
  | "DIRECTION_MISMATCH"
  | "ANCHOR_REQUIRED"
  | "TRANSFER_EQUALS_SOURCE"
  | "END_BEFORE_START"
  | "NEGATIVE_AMOUNT"
  | "EFFECTIVE_MONTH_TAKEN"
  | "LAST_AMOUNT"
  | "AMOUNT_GAP"
  | "MONTH_NOT_ACTIVE"
  | "MONTH_NOT_DUE"
  | "MONTH_OUT_OF_HORIZON";

type TransportCode =
  "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "TOO_MANY_REQUESTS" | "CONFLICT";

/** The mapping table from contracts/errors.md. */
export const APP_ERROR_TRANSPORT: Readonly<Record<AppErrorCode, TransportCode>> = {
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

/**
 * Details permitted per code. Counts, months and paths only — never an amount,
 * an account identifier, an email address or any user-supplied string.
 *
 * NOT_FOUND is absent from this map on purpose: it takes no details.
 */
export interface AppErrorDetails {
  VALIDATION_FAILED: { path: string[] };
  AUTH_FAILED: never;
  NOT_FOUND: never;
  RATE_LIMITED: { retryAfterSeconds: number };
  NAME_TAKEN: never;
  STILL_REFERENCED: { referenceCount: number };
  DIRECTION_IMMUTABLE: never;
  DIRECTION_MISMATCH: { categoryDirection: "income" | "expense" };
  ANCHOR_REQUIRED: never;
  TRANSFER_EQUALS_SOURCE: never;
  END_BEFORE_START: never;
  NEGATIVE_AMOUNT: never;
  EFFECTIVE_MONTH_TAKEN: { month: string };
  LAST_AMOUNT: never;
  AMOUNT_GAP: { firstUncoveredMonth: string };
  MONTH_NOT_ACTIVE: { activeFrom: string; activeTo: string | null };
  MONTH_NOT_DUE: { dueMonths: string[] };
  MONTH_OUT_OF_HORIZON: { firstMonth: string; lastMonth: string };
}

/** The allow-list, enforced at construction rather than trusted. */
const PERMITTED_DETAIL_KEYS: Readonly<Record<AppErrorCode, readonly string[]>> = {
  VALIDATION_FAILED: ["path"],
  AUTH_FAILED: [],
  NOT_FOUND: [],
  RATE_LIMITED: ["retryAfterSeconds"],
  NAME_TAKEN: [],
  STILL_REFERENCED: ["referenceCount"],
  DIRECTION_IMMUTABLE: [],
  DIRECTION_MISMATCH: ["categoryDirection"],
  ANCHOR_REQUIRED: [],
  TRANSFER_EQUALS_SOURCE: [],
  END_BEFORE_START: [],
  NEGATIVE_AMOUNT: [],
  EFFECTIVE_MONTH_TAKEN: ["month"],
  LAST_AMOUNT: [],
  AMOUNT_GAP: ["firstUncoveredMonth"],
  MONTH_NOT_ACTIVE: ["activeFrom", "activeTo"],
  MONTH_NOT_DUE: ["dueMonths"],
  MONTH_OUT_OF_HORIZON: ["firstMonth", "lastMonth"],
};

export interface AppError<Code extends AppErrorCode = AppErrorCode> {
  readonly appCode: Code;
  readonly details?: Record<string, unknown>;
}

type DetailsFor<Code extends AppErrorCode> = AppErrorDetails[Code] extends never
  ? []
  : [details: AppErrorDetails[Code]];

export function appError<Code extends AppErrorCode>(
  code: Code,
  ...rest: DetailsFor<Code>
): AppError<Code> {
  const details = rest[0] as Record<string, unknown> | undefined;
  if (details === undefined) {
    return { appCode: code };
  }

  const permitted = PERMITTED_DETAIL_KEYS[code];
  if (permitted.length === 0) {
    throw new Error(
      `${code} takes no details: adding any would make it distinguishable from an identical failure elsewhere`,
    );
  }

  for (const key of Object.keys(details)) {
    if (!permitted.includes(key)) {
      throw new Error(
        `${code} detail may not carry ${JSON.stringify(key)}: Article VIII forbids personal data, account identifiers and monetary amounts in error payloads. Permitted: ${permitted.join(", ")}`,
      );
    }
  }

  return { appCode: code, details };
}

/** A machine token for logs. Lowercased code; never a sentence, never translated. */
function messageToken(code: AppErrorCode): string {
  return code.toLowerCase();
}

export function toTrpcError(error: AppError): TRPCError {
  return new TRPCError({
    code: APP_ERROR_TRANSPORT[error.appCode],
    message: messageToken(error.appCode),
    cause: error,
  });
}

/**
 * The single constructor for "you cannot have this".
 *
 * Deliberately takes no arguments. Every caller — a genuinely missing row, a
 * row in another workspace, a row the session may not touch — produces the
 * identical error, because that is the only way the three stay
 * indistinguishable as the codebase grows.
 */
export function notFound(): AppError<"NOT_FOUND"> {
  return { appCode: "NOT_FOUND" };
}
