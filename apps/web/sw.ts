/// <reference lib="webworker" />
import type {
  PrecacheEntry,
  RouteHandlerCallbackOptions,
  SerwistGlobalConfig,
  SerwistPlugin,
} from "serwist";
import { CacheFirst, NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * T098/T099 (ADR 0006): read-only offline support for the dashboard.
 *
 *  - every `dashboard.*` *query* (`GET /api/trpc/dashboard....`) is
 *    stale-while-revalidate, with an `x-cached-at` header stamped on the
 *    cached copy at write time, so a stale read can be distinguished from a
 *    fresh one (FR-035b). Scoped to `dashboard.*` rather than every query in
 *    the app: every other screen (accounts, categories, commitments) does a
 *    plain mutate-then-reload with no cache-invalidation awareness of its
 *    own, and a cached stale-while-revalidate response there would make a
 *    freshly created row briefly invisible after its own creation — not an
 *    offline concern this feature is scoped to solve;
 *  - `health.ping` is never cached as a defence in depth, even though it
 *    already falls outside the `dashboard.*` scope above — a cached success
 *    would report a live server to an offline client;
 *  - every *mutation* (`POST /api/trpc/...`), app-wide, is tried on the
 *    network and, only if that fails, answered immediately with
 *    `OFFLINE_READ_ONLY` rather than left to hang to a transport timeout
 *    (FR-035c/d). Nothing is queued: there is no write queue in this release
 *    (research, decisions/0006).
 */

const TRPC_PREFIX = "/api/trpc/";
const DASHBOARD_QUERY_PREFIX = "/api/trpc/dashboard.";
const HEALTH_PATH = "/api/trpc/health.ping";

/** Stamps the response actually written to the runtime cache with its retrieval time. */
const stampCachedAt: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) => {
    if (!response.ok) return null;
    const headers = new Headers(response.headers);
    headers.set("x-cached-at", new Date().toISOString());
    const body = await response.clone().arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

/**
 * The wire shape from contracts/errors.md, hand-built here because this runs
 * in the service worker, outside `packages/api`: `-32600` is
 * `TRPC_ERROR_CODES_BY_KEY.BAD_REQUEST`, matched by hand rather than
 * imported to keep the worker bundle free of the server's dependency graph.
 */
function offlineReadOnlyResponse(path: string): Response {
  const body = {
    error: {
      message: "offline_read_only",
      code: -32600,
      data: {
        code: "BAD_REQUEST",
        httpStatus: 400,
        path,
        appCode: "OFFLINE_READ_ONLY",
      },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

async function handleMutation({ request, url }: RouteHandlerCallbackOptions): Promise<Response> {
  try {
    // A real attempt, not a `navigator.onLine` guess: the only signal that
    // cannot lie is the network itself refusing the request.
    return await fetch(request.clone());
  } catch {
    const path = url.pathname.slice(TRPC_PREFIX.length) || url.pathname;
    return offlineReadOnlyResponse(path);
  }
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // Next's own build output (`/_next/static/...`): content-hashed and
      // immutable, so a cache-first read never goes stale. Not covered by
      // `globPublicPatterns`, which only scans `apps/web/public`; the cached
      // navigation document below is otherwise a shell with nothing to run.
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: "next-static" }),
    },
    {
      // The app shell itself (Story 3 scenario 7: "the app launches with the
      // network disabled"). `apps/web/app/layout.tsx` reads `headers()` for
      // its per-request CSP nonce, which makes every page dynamically
      // rendered — there is no static HTML file to precache at build time —
      // so the only way a previously visited route can still open offline is
      // a cached copy of its own prior response, kept fresh with every
      // online visit.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 3 }),
    },
    {
      method: "POST",
      matcher: ({ url }) => url.pathname.startsWith(TRPC_PREFIX),
      handler: handleMutation,
    },
    {
      method: "GET",
      matcher: ({ url }) => url.pathname === HEALTH_PATH,
      handler: new NetworkOnly(),
    },
    {
      method: "GET",
      matcher: ({ url }) => url.pathname.startsWith(DASHBOARD_QUERY_PREFIX),
      handler: new StaleWhileRevalidate({
        cacheName: "dashboard-queries",
        plugins: [stampCachedAt],
      }),
    },
  ],
});

serwist.addEventListeners();
