import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
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
