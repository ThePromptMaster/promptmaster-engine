import { cookies } from 'next/headers';

import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { LOCALE_KEY, localeFromCookie } from '@/lib/i18n/locales';

/**
 * The landing page, in the language this browser chose (23 Oct: the whole
 * site in the chosen language). Reading the cookie renders it per request, so
 * a visitor who picked Español sees Spanish from the first byte; only `/` is
 * dynamic, not every route under the root layout.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = localeFromCookie((await cookies()).get(LOCALE_KEY)?.value);
  return <I18nProvider initialLocale={locale}>{children}</I18nProvider>;
}
