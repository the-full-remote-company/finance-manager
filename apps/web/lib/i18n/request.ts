import { getRequestConfig } from "next-intl/server";

/**
 * "Locale": de-DE default, next-intl, i18n from the first screen.
 *
 * One locale exists today. It is wired through next-intl anyway, because
 * FR-042 requires that no user-facing text be hard-coded in a way that
 * prevents later translation, and retrofitting i18n is a rewrite of the view
 * layer.
 *
 * Currency and date formatting is Intl.NumberFormat / Intl.DateTimeFormat via
 * next-intl's formatter — never hand-rolled (Article II).
 */
export const locales = ["de-DE"] as const;
export const defaultLocale = "de-DE" as const;

export default getRequestConfig(async () => {
  const locale = defaultLocale;

  return {
    locale,
    timeZone: "Europe/Berlin",
    messages: (await import("../../messages/de.json")).default,
    formats: {
      number: {
        // EUR with German conventions: 950,00 €
        currency: { style: "currency", currency: "EUR" },
      },
      dateTime: {
        // 15.03.2026
        date: { day: "2-digit", month: "2-digit", year: "numeric" },
      },
    },
  };
});
