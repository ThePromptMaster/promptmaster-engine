'use client';

import Link from 'next/link';

import { useT } from '@/lib/i18n/i18n-provider';

export default function NotFound() {
  // In the chosen language (23 Oct); it switches once the page has loaded.
  const t = useT();
  return (
    <div className="bg-[var(--surface)] flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[480px] text-center space-y-8">
        {/* Large 404 */}
        <div className="relative">
          <span
            className="block font-extrabold tracking-tighter text-[var(--surface-container-high)] select-none leading-none"
            style={{ fontSize: '10rem' }}
          >
            {'404'}
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-[var(--pm-primary)] text-[48px]">
              explore_off
            </span>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-[var(--on-surface)] tracking-tight">
            {t('notFound.title')}
          </h1>
          <p className="text-body text-[var(--on-surface-variant)] leading-relaxed max-w-[320px] mx-auto">
            {t('notFound.body')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/projects"
            className="px-6 py-3 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-xl hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 text-title flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">dashboard</span>
            {t('notFound.dashboard')}
          </Link>
          <Link
            href="/auth/login"
            className="px-6 py-3 bg-[var(--surface-container-low)] text-[var(--on-surface)] font-medium rounded-xl hover:bg-[var(--surface-container-high)] transition-all duration-200 text-title flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">login</span>
            {t('notFound.signIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
