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
  // Sean, 24 Oct: "the next language should be Hindi and then Mandarin. Arabic and Swahili."
  { code: 'hi', own: 'हिन्दी' },
  { code: 'zh', own: '中文' },
  { code: 'ar', own: 'العربية' },
  { code: 'sw', own: 'Kiswahili' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';

/** Arabic is read right to left: the whole page mirrors (Sean, 24 Oct). */
export function localeDirection(code: string | null | undefined): 'rtl' | 'ltr' {
  return resolveLocale(code) === 'ar' ? 'rtl' : 'ltr';
}

/** Where the choice is kept: localStorage for the browser, a cookie so the server renders it too. */
export const LOCALE_KEY = 'pm.locale';

/** An offered locale, or English for anything else: an exact code first, then its language ("es-MX" is "es"). */
export function resolveLocale(code: string | null | undefined): Locale {
  const exact = (code ?? '').trim().toLowerCase();
  if (LOCALES.some((l) => l.code === exact)) return exact as Locale;
  const c = exact.slice(0, 2);
  return LOCALES.some((l) => l.code === c) ? (c as Locale) : DEFAULT_LOCALE;
}

/** A locale from a cookie header value, or null when none was chosen. */
export function localeFromCookie(value: string | null | undefined): Locale | null {
  return value ? resolveLocale(value) : null;
}
