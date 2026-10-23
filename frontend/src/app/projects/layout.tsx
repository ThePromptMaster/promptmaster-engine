import { cookies } from 'next/headers';

import { AppHeader } from '@/components/shared/app-header';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { LOCALE_KEY, localeFromCookie } from '@/lib/i18n/locales';

// Force dynamic rendering — project pages depend on Supabase runtime env vars.
export const dynamic = 'force-dynamic';

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request anyway, so the interface language chosen in this
  // browser (client, 21 Oct) is known here and the page never flashes English.
  const locale = localeFromCookie((await cookies()).get(LOCALE_KEY)?.value);
  return (
    <I18nProvider initialLocale={locale}>
      <div className="min-h-screen bg-[var(--surface)]">
        {/* Every signed-in route carries the same chrome, so the header never
            changes shape as you move between the list and a project. */}
        <AppHeader />
        {children}
      </div>
    </I18nProvider>
  );
}
