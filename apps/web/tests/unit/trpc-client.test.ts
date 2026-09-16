import { describe, expect, it, vi } from "vitest";
import { createWebTrpcClient } from "../../lib/trpc/client.js";

/**
 * VQ-2: the transport must issue queries as HTTP GET, unconditionally, so the
 * T098 service worker can cache them. This asserts the actual `Request`
 * method reaching `fetch`, not the link's configuration, because a
 * configuration can be correct on paper and still be undone by a default
 * elsewhere.
 */
describe("createWebTrpcClient (VQ-2)", () => {
  it("issues a query as GET with the largest real input for this feature", async () => {
    const requests: Request[] = [];
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ result: { data: { json: { ok: true } } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createWebTrpcClient("https://example.test/api/trpc");

    // dashboard.month's input: a month key plus a presentation flag — the
    // largest real query input in this feature (research.md Part A6).
    await (
      client as unknown as {
        dashboard: { month: { query: (input: unknown) => Promise<unknown> } };
      }
    ).dashboard.month.query({ month: "2026-09", presentation: "smoothed" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");

    vi.unstubAllGlobals();
  });

  it("issues a mutation as POST, unaffected by the query pin", async () => {
    const requests: Request[] = [];
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ result: { data: { json: { ok: true } } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createWebTrpcClient("https://example.test/api/trpc");

    await (
      client as unknown as {
        auth: { signOut: { mutate: () => Promise<unknown> } };
      }
    ).auth.signOut.mutate();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");

    vi.unstubAllGlobals();
  });
});
