import { appRouter, createContext } from "@finance/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

/**
 * The tRPC endpoint for the web client.
 *
 * Queries are issued as GET and mutations as POST, pinned in the client
 * transport rather than inherited from a default, because ADR 0006 depends on
 * queries being cacheable by the service worker and a query that silently
 * degrades to POST would break FR-035b (VQ-2).
 */
function handler(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createContext(request),
    onError({ error, path }) {
      // Never log the input: it carries monetary amounts and account names,
      // which Article VIII forbids in application logs.
      console.error(`trpc error on ${path ?? "<no path>"}: ${error.code}`);
    },
  });
}

export { handler as GET, handler as POST };
