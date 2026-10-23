'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import { DEFAULT_LOCALE, type Locale } from './locales';
import type { MessageKey } from './messages/en';
import { getLocale, subscribeLocale } from './store';
import { translate, type Vars } from './translate';

/** What the server rendered in: English, or the cookie's choice where a layout could read it. */
const ServerLocale = createContext<Locale>(DEFAULT_LOCALE);

/**
 * The interface language for everything under it.
 *
 * `initialLocale` is what the server knows (the `pm.locale` cookie, read by a
 * layout that renders per request); the browser's own choice takes over after
 * hydration. When the two agree, which is the usual case once a language has
 * been chosen, nothing changes on screen.
 */
export function I18nProvider({ initialLocale, children }: { initialLocale?: Locale | null; children: React.ReactNode }) {
  const outer = useContext(ServerLocale);
  const server = initialLocale ?? outer;
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => server);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <ServerLocale.Provider value={server}>{children}</ServerLocale.Provider>;
}

export function useLocale(): Locale {
  const server = useContext(ServerLocale);
  return useSyncExternalStore(subscribeLocale, getLocale, () => server);
}

/** `t(key, vars)` in the current interface language; re-renders when it changes. */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}
