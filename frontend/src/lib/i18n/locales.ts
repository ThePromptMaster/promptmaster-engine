/**
 * The languages the interface can be read in (client, 21 Oct: "Can we do pick
 * your language?" — part 2, the interface).
 *
 * This is the app's own words: buttons, headings, notices. What a project is
 * written in is its "Writes in" language (`lib/workflow/languages.ts`), chosen
 * per project; the two are separate on purpose, so a Spanish speaker can write
 * a report in English and the other way round.
 */
export const LOCALES = [
  { code: 'en', own: 'English' },
  { code: 'es', own: 'Español' },
  { code: 'fr', own: 'Français' },
  { code: 'pt', own: 'Português' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';

/** Where the choice is kept: localStorage for the browser, a cookie so the server renders it too. */
export const LOCALE_KEY = 'pm.locale';

/** An offered locale, or English for anything else ("es-MX" is "es"). */
export function resolveLocale(code: string | null | undefined): Locale {
  const c = (code ?? '').trim().toLowerCase().slice(0, 2);
  return LOCALES.some((l) => l.code === c) ? (c as Locale) : DEFAULT_LOCALE;
}

/** A locale from a cookie header value, or null when none was chosen. */
export function localeFromCookie(value: string | null | undefined): Locale | null {
  return value ? resolveLocale(value) : null;
}
