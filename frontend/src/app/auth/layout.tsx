import { cookies } from 'next/headers';

import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { LOCALE_KEY, localeFromCookie } from '@/lib/i18n/locales';

// Force all auth pages to be dynamically rendered (not statically generated)
// since they depend on Supabase client which requires runtime env vars.
export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request anyway, so the language chosen in this browser is
  // known here and signing in never flashes English (23 Oct).
  const locale = localeFromCookie((await cookies()).get(LOCALE_KEY)?.value);
  return <I18nProvider initialLocale={locale}>{children}</I18nProvider>;
}
