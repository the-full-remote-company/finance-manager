import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

/**
 * "Baseline security controls": HTTPS only, HSTS, and a strict
 * Content-Security-Policy without `unsafe-inline` for scripts.
 *
 * `unsafe-inline` is absent from script-src. Next.js inline bootstrap scripts
 * are permitted by nonce in the middleware, never by relaxing the directive.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Article VII: the application must build and run in a self-hosted
  // configuration, and CI must prove it. `standalone` is what the container
  // build boots.
  output: "standalone",
  transpilePackages: [
    "@finance/core",
    "@finance/ui",
    "@finance/api",
    "@finance/auth",
    "@finance/db",
  ],
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default withNextIntl(nextConfig);
