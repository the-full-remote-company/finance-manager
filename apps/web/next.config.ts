import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * The one property of webpack's `Configuration` this file touches. Next.js
 * types its `webpack()` hook's `config` parameter as `any` (it re-exports
 * whatever the installed webpack version's type is, which this app does not
 * depend on directly), so this is typed narrowly here rather than accepted
 * as `any` and left unsafe throughout the function body.
 */
interface WebpackResolveConfig {
  resolve?: {
    extensionAlias?: Record<string, string[]>;
    [key: string]: unknown;
  };
  externals?: unknown[];
  [key: string]: unknown;
}

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

// T098 (ADR 0006): the service worker is only built for a production build —
// `next dev` never activates one, and `disable` here, not a separate flag,
// is what keeps the dev server's hot reload from fighting a stale worker.
const withSerwist = withSerwistInit({
  swSrc: "sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});

/**
 * "Baseline security controls": HTTPS only, HSTS, and a strict
 * Content-Security-Policy without `unsafe-inline` for scripts.
 *
 * `unsafe-inline` is absent from script-src. Next.js inline bootstrap scripts
 * are permitted by nonce in `proxy.ts`, never by relaxing the directive. The
 * Content-Security-Policy header itself is set there, not here, because a
 * strict `script-src` nonce must be fresh per request; this static list is
 * everything that safely can be.
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
  // This build uses webpack (`next build --webpack` / `next dev --webpack`,
  // see package.json), not the Turbopack default. Every package in this
  // monorepo is written NodeNext-style — a relative import writes the
  // sibling's compiled extension (`./router.js`) even though only `router.ts`
  // exists on disk, which is correct for `tsc` and for Vitest's esbuild
  // transform, both of which already map `.js` back to `.ts`. Turbopack does
  // not expose an equivalent mapping as of Next 16 (only `resolveExtensions`,
  // which extends extension-*less* resolution, not this one); webpack's
  // `resolve.extensionAlias` does exactly this, so this app builds on
  // webpack until Turbopack gains the equivalent — the alternative is
  // dropping the NodeNext convention from every package for one app's
  // bundler, which is the wrong package to bend.
  webpack(config: WebpackResolveConfig, { isServer }: { isServer: boolean }) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    if (isServer) {
      // `serverExternalPackages` alone did not keep webpack from trying to
      // parse `@node-rs/argon2`'s native `.node` binary as JavaScript here —
      // `@finance/auth` sits in `transpilePackages`, which pulls its whole
      // dependency graph into the bundle regardless. Externalizing directly
      // is what actually keeps the binary a runtime `require()`, never a
      // bundled module.
      config.externals = [...(config.externals ?? []), "@node-rs/argon2"];
    }

    return config;
  },
};

export default withSerwist(withNextIntl(nextConfig));
