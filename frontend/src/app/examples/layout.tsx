import { cookies } from 'next/headers';

import { ExamplesHeader } from '@/components/examples/examples-header';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { LOCALE_KEY, localeFromCookie } from '@/lib/i18n/locales';

// The Supabase client needs runtime env vars, and the language is per request.
export const dynamic = 'force-dynamic';

/**
 * The curated examples, public: `proxy.ts` matches only `/projects` and `/auth`,
 * so a visitor can see what PromptMaster does before making an account.
 */
export default async function ExamplesLayout({ children }: { children: React.ReactNode }) {
  const locale = localeFromCookie((await cookies()).get(LOCALE_KEY)?.value);
  return (
    <I18nProvider initialLocale={locale}>
      <div className="min-h-screen bg-[var(--surface)]">
        <ExamplesHeader />
        {children}
      </div>
    </I18nProvider>
  );
}
