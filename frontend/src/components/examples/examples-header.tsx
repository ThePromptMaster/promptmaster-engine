'use client';

import Link from 'next/link';

import { useAuth } from '@/hooks/use-auth';
import { LocaleSwitch } from '@/components/shared/locale-switch';
import { useT } from '@/lib/i18n/i18n-provider';

/**
 * The examples are public, so a visitor may have no account: the way home is the
 * landing page, and the right side offers signing in rather than an account menu
 * with nobody in it.
 */
export function ExamplesHeader() {
  const t = useT();
  const { user, loading } = useAuth();
  return (
    <header className="bg-[var(--surface-container-lowest)]">
      <div className="flex items-center gap-4 px-4 py-3 sm:px-6 md:px-10">
        <Link href={user ? '/projects' : '/'} className="flex min-w-0 items-center gap-2.5 rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" aria-hidden className="h-7 w-7 rounded-lg" />
          <span className="text-title tracking-tight text-[var(--on-surface)]">PromptMaster</span>
        </Link>
        <LocaleSwitch className="ms-auto hidden md:flex" />
        {!loading && (
          <Link
            href={user ? '/projects' : '/auth/login'}
            className="ms-auto shrink-0 rounded-full bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-high)] md:ms-0"
          >
            {user ? t('ex.myProjects') : t('ex.signIn')}
          </Link>
        )}
      </div>
    </header>
  );
}
