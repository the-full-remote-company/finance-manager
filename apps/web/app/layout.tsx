import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never maximum-scale=1 or user-scalable=no: both break WCAG 2.2 SC 1.4.4.
};

/**
 * App shell. Article IV: a skip link, landmark regions, and a live region the
 * throttle countdown and the offline announcements write into — an error that
 * is only visible is an error a screen reader user does not receive.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading a request header opts this route into dynamic rendering. That is
  // not incidental here: `proxy.ts` mints a fresh nonce per request, and a
  // statically prerendered page's HTML is written once at build time — it
  // can never contain a nonce that matches a later request's CSP header.
  // Confirmed by reproducing the failure: every one of Next's own bootstrap
  // scripts loaded with no `nonce` attribute at all on a static page, and
  // the strict CSP rejected every one, leaving the page never interactive.
  // The value itself is unused; only the read is load-bearing.
  await headers();

  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("app");

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <a className="btn btn--ghost" href="#main">
            {t("skipToContent")}
          </a>
          <main id="main">{children}</main>
          <div id="live-region" role="status" aria-live="polite" aria-atomic="true" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
