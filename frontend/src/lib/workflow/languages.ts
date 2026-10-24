/**
 * The languages a project's work can be written in (client, 21 Oct: "Can we
 * do pick your language?"). The same list as `backend/promptmaster/language.py`;
 * `languages-drift.test.ts` keeps them equal.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', own: 'English' },
  { code: 'es', name: 'Spanish', own: 'español' },
  { code: 'fr', name: 'French', own: 'français' },
  { code: 'pt', name: 'Portuguese', own: 'português' },
  { code: 'de', name: 'German', own: 'Deutsch' },
  { code: 'it', name: 'Italian', own: 'italiano' },
  { code: 'nl', name: 'Dutch', own: 'Nederlands' },
  // Sean, 24 Oct: "the next language should be Hindi and then Mandarin. Arabic and Swahili."
  { code: 'hi', name: 'Hindi', own: 'हिन्दी' },
  { code: 'zh', name: 'Chinese (Mandarin, Simplified)', own: '中文' },
  { code: 'ar', name: 'Arabic', own: 'العربية' },
  { code: 'sw', name: 'Swahili', own: 'Kiswahili' },
  // "Maybe even Ebonics too": a variety of English, so it is offered as one.
  { code: 'en-aave', name: 'African American English', own: 'African American English' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** An offered code, or English for anything else: an exact code first ("en-aave"), then its language ("es-MX" is "es"). */
export function resolveLanguage(code: string | null | undefined): LanguageCode {
  const exact = (code ?? '').trim().toLowerCase();
  if (LANGUAGES.some((l) => l.code === exact)) return exact as LanguageCode;
  const c = exact.slice(0, 2);
  return LANGUAGES.some((l) => l.code === c) ? (c as LanguageCode) : DEFAULT_LANGUAGE;
}

/** Arabic is written right to left. */
export function languageDirection(code: string | null | undefined): 'rtl' | 'ltr' {
  return resolveLanguage(code) === 'ar' ? 'rtl' : 'ltr';
}

/** The browser's own language when it is one we offer, else English: a new project's default. */
export function browserLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  return resolveLanguage(navigator.language);
}

/** "español (Spanish)", or "English". */
export function languageLabel(code: string | null | undefined): string {
  const l = LANGUAGES.find((x) => x.code === resolveLanguage(code))!;
  return l.code === 'en' || l.own === l.name ? l.name : `${l.own} (${l.name})`;
}

/**
 * What a new project writes in before anyone chooses: the interface language
 * when it is not English (someone reading the app in Spanish writes in
 * Spanish), else the browser's own language when offered, else English.
 */
export function startLanguage(interfaceLocale: string): LanguageCode {
  return interfaceLocale && interfaceLocale !== 'en' ? resolveLanguage(interfaceLocale) : browserLanguage();
}
