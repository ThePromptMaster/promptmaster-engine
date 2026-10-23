'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { LOCALES } from '@/lib/i18n/locales';
import { setLocale } from '@/lib/i18n/store';

/**
 * The interface language, for pages without the account menu: signing in,
 * signing up, the landing page (23 Oct: the whole site in the chosen
 * language). Each language by its own name, so someone who cannot read the
 * current one can still find theirs.
 */
export function LocaleSwitch({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className={`flex flex-wrap items-center justify-center gap-1 ${className}`} role="group" aria-label={t('auth.language')}>
      <span aria-hidden className={`material-symbols-outlined mr-1 text-[16px] ${tone === 'dark' ? 'text-white/60' : 'text-[var(--on-surface-variant)]'}`}>
        translate
      </span>
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          aria-pressed={locale === l.code}
          onClick={() => setLocale(l.code)}
          className={`rounded-md px-2 py-0.5 text-label transition-colors ${
            tone === 'dark'
              ? locale === l.code
                ? 'bg-white/10 font-medium text-white'
                : 'text-white/60 hover:text-white'
              : locale === l.code
                ? 'bg-[var(--surface-container-high)] font-medium text-[var(--on-surface)]'
                : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
          }`}
        >
          {l.own}
        </button>
      ))}
    </div>
  );
}
