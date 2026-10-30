import type { AppRouter } from "@finance/api";
import { isTRPCClientError } from "@trpc/client";
import { createWebTrpcClient } from "./client.js";

/**
 * The one browser-side tRPC client instance. `/api/trpc` is relative, so it
 * resolves against whatever origin the page was served from — no
 * environment-specific base URL to configure.
 */
export const trpc = createWebTrpcClient("/api/trpc");

/**
 * The subset of a `VALIDATION_FAILED` / `AUTH_FAILED` / `RATE_LIMITED` error
 * the UI needs, narrowed from an unknown thrown value.
 *
 * `error.data` carries `errorFormatter`'s enrichment (packages/api/src/trpc.ts):
 * `appCode` and, where the code permits it, `details`. The UI selects its
 * string by `appCode`, never from `error.message`, which is a machine token
 * for logs, not a sentence (contracts/errors.md).
 */
export interface AppClientError {
  readonly appCode: string;
  readonly details: Record<string, unknown> | undefined;
}

export function toAppClientError(error: unknown): AppClientError | null {
  if (!isTRPCClientError<AppRouter>(error)) return null;
  const appCode = (error.data as { appCode?: unknown } | null)?.appCode;
  if (typeof appCode !== "string") return null;

  const details = (error.data as { details?: Record<string, unknown> } | null)?.details;
  return { appCode, details };
}
