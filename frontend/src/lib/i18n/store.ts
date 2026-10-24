import { DEFAULT_LOCALE, LOCALE_KEY, localeDirection, resolveLocale, type Locale } from './locales';
import { translate, type Vars } from './translate';
import type { MessageKey } from './messages/en';

/**
 * The interface language, held once for the whole page.
 *
 * Module-level, like the request's thinking level: pure code that is not a
 * component (status words, error copy) reads it through `tr`, and components
 * subscribe through `useLocale`. The choice is kept in localStorage and in a
 * cookie, so the server can render a signed-in page in it from the first byte
 * (`app/projects/layout.tsx`) instead of flashing English.
 */
let current: Locale | null = null;
const listeners = new Set<() => void>();

function readStored(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    if (stored) return resolveLocale(stored);
  } catch {
    // Private windows and blocked storage: try the cookie.
  }
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(?:^|;\s*)pm\.locale=([^;]+)/);
    if (m) return resolveLocale(decodeURIComponent(m[1]));
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  if (current) return current;
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  current = readStored();
  return current;
}

export function subscribeLocale(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Choose the interface language: kept in this browser and a cookie, applied everywhere at once. */
export function setLocale(code: string): void {
  const next = resolveLocale(code);
  current = next;
  try {
    window.localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // The choice lasts for this page only.
  }
  if (typeof document !== 'undefined') {
    document.cookie = `${LOCALE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = localeDirection(next);
  }
  listeners.forEach((l) => l());
}

/** For tests: forget the choice. */
export function resetLocaleForTests(): void {
  current = null;
}

/** The words for `key` in the current language, for code that is not a component. */
export function tr(key: MessageKey, vars?: Vars): string {
  return translate(getLocale(), key, vars);
}
