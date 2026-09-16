import { NextResponse, type NextRequest } from "next/server";

/**
 * "Baseline security controls": a strict Content-Security-Policy without
 * `unsafe-inline` for scripts.
 *
 * The policy is per-request, not static, because a strict `script-src`
 * requires a fresh nonce every request — a fixed nonce in `next.config.ts`'s
 * static `headers()` would be a fixed value an attacker could simply reuse,
 * which is not a nonce at all. Next.js reads this header's nonce and applies
 * it automatically to the scripts it generates for hydration; nothing in this
 * app renders an inline `<script>` of its own.
 *
 * `strict-dynamic` lets a nonce-bearing script load further scripts (Next's
 * own chunk-loading) without listing every chunk URL, while keeping every
 * *other* origin unable to inject a script that runs.
 */
export function proxy(request: NextRequest): NextResponse {
  // The Web Crypto global, not `node:crypto`: this runs on the Edge Runtime,
  // which does not support Node built-ins.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind and @tfrc/product compile to external stylesheets; the app
    // renders no inline style attribute or <style> tag of its own. Kept
    // permissive here only because Next.js itself may inject one for
    // framework internals; `script-src` is the directive this control is
    // actually about.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Every route except static assets and the manifest/service worker,
    // which carry their own caching concerns and need no CSP of their own.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)",
  ],
};
