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
async function handler(request: Request): Promise<Response> {
  const { context, cookies } = createContext(request);

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => context,
    onError({ error, path }) {
      // Never log the input: it carries monetary amounts and account names,
      // which Article VIII forbids in application logs.
      console.error(`trpc error on ${path ?? "<no path>"}: ${error.code}`);
    },
  });

  // auth.register / auth.signIn / auth.signOut set these on `context` during
  // the call; the fetch adapter has no hook for a resolver to reach the
  // outgoing Response itself, so they are appended here instead.
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { handler as GET, handler as POST };
