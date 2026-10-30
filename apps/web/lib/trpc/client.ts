import type { AppRouter } from "@finance/api";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";

/**
 * VQ-2 (research.md Part A6, ADR 0006): the tRPC client transport, pinned
 * rather than left to a default.
 *
 * `httpBatchLink` was rejected here even though batching is the usual
 * default: it issues GET for a query only up to `maxURLLength` (2 083 bytes
 * by default) and silently falls back to POST once a batched URL would
 * exceed it. That fallback is invisible at the call site and would make the
 * affected query uncacheable by the T098 service worker, breaking FR-035b
 * without a build failure anywhere.
 *
 * `httpLink` (non-batching) has no such fallback: every query is GET,
 * unconditionally, because there is no batch URL whose length depends on how
 * many operations happen to fire together. That is the whole fix — removing
 * the escape hatch rather than tuning its threshold.
 *
 * The largest real query input in this feature is `dashboard.month`'s
 * `{ month: "YYYY-MM", presentation: "smoothed" | "cash" }`
 * (contracts/procedures.md), which serialises to well under 100 bytes as a
 * URL-encoded `input` query parameter — nowhere near even
 * `httpBatchLink`'s default budget. The risk this spike addresses is a
 * *silent* degradation, not this feature's inputs being too large in
 * practice; `httpLink` removes the possibility outright rather than relying
 * on staying under a budget.
 */
export function createWebTrpcClient(url: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url,
        // No methodOverride: mutations remain POST, queries remain GET.
      }),
    ],
  });
}
