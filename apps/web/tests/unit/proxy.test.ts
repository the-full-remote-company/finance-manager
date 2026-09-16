import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy.js";

/**
 * "Baseline security controls": a strict Content-Security-Policy without
 * `unsafe-inline` for scripts.
 */
describe("proxy CSP (T067)", () => {
  it("sets a Content-Security-Policy with no unsafe-inline in script-src", () => {
    const request = new NextRequest("https://example.test/");
    const response = proxy(request);

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).not.toBeNull();

    const scriptSrc = csp
      ?.split(";")
      .find((directive) => directive.trim().startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  it("uses a fresh nonce on every request", () => {
    const first = proxy(new NextRequest("https://example.test/"));
    const second = proxy(new NextRequest("https://example.test/"));

    const nonceOf = (response: ReturnType<typeof proxy>): string | null => {
      const csp = response.headers.get("Content-Security-Policy");
      return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? "")?.[1] ?? null;
    };

    const firstNonce = nonceOf(first);
    const secondNonce = nonceOf(second);
    expect(firstNonce).not.toBeNull();
    expect(firstNonce).not.toBe(secondNonce);
  });

  it("forwards the nonce to the request so a server component can read it", () => {
    const request = new NextRequest("https://example.test/");
    const response = proxy(request);

    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("denies framing entirely", () => {
    const response = proxy(new NextRequest("https://example.test/"));
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
