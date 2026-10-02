/** Filipino and English at launch; more languages come by rollout wave. */
export const LOCALES = ["en", "fil"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "locale";

export function resolveLocale(value: string | undefined): Locale {
  return LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE;
}
