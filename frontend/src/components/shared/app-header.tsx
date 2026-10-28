'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { SAVE_ACCOUNT_EVENT } from '@/components/projects/guest-banner';
import { ColourPicker } from './colour-preferences';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { LOCALES } from '@/lib/i18n/locales';
import { setLocale } from '@/lib/i18n/store';
import type { MessageKey } from '@/lib/i18n/messages/en';

/**
 * The application header.
 *
 * Until now the signed-in app had no chrome at all: `/projects` opened straight
 * onto a bare list, and `signOut` existed on `use-auth` with nothing calling
 * it. There was no way to leave the account from inside the product.
 *
 * Two things live here and nothing else. Product identity on the left, which
 * doubles as the way home; the account on the right, which is the only place
 * sign-out belongs. Everything about a *project* stays on the project page —
 * putting it up here would make the header change shape between routes, and a
 * header that moves is worse than no header.
 */

/** A guest has no email, so it is the label that has to say what they are. */
function accountLabel(email: string | undefined, isGuest: boolean, t: (key: MessageKey) => string): string {
  if (isGuest) return t('header.guest');
  return email ?? t('header.signedIn');
}

/**
 * The interface language (client, 21 Oct: "Can we do pick your language?").
 * Each language by its own name, so someone who cannot read the current one
 * can still find theirs.
 */
function LanguagePicker() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="px-4 py-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('header.language')}>
        {LOCALES.map((l) => (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            aria-pressed={locale === l.code}
            onClick={() => setLocale(l.code)}
            className={`rounded-lg px-2.5 py-1 text-label transition-colors ${
              locale === l.code
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-low)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
            }`}
          >
            {l.own}
          </button>
        ))}
      </div>
      <p className="mt-2 text-label leading-snug text-[var(--on-surface-variant)]">{t('header.languageNote')}</p>
    </div>
  );
}

/** One glyph for the avatar disc — the first letter, or a person icon. */
function accountInitial(email: string | undefined, isGuest: boolean): string | null {
  if (isGuest) return null;
  const first = email?.trim()?.[0];
  return first ? first.toUpperCase() : null;
}

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, isGuest, signOut } = useAuth();
  const t = useT();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [colours, setColours] = useState(false);
  const [language, setLanguage] = useState(false);
  // A guest's sign-out is asked twice (14 Oct call): it ends the only identity
  // their projects belong to, and there is no signing back in to it.
  const [confirmGuestOut, setConfirmGuestOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click-outside and Escape both close, because a menu that only closes by
  // pressing its own trigger again is a menu people leave open by accident.
  useEffect(() => {
    if (!open) {
      setConfirmGuestOut(false);
      return;
    }

    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setBusy(true);
    try {
      // `signOut` flushes whatever the open project has pending before the
      // session goes — once it is gone RLS refuses the write.
      await signOut();
      setOpen(false);
      router.push('/auth/login');
    } finally {
      setBusy(false);
    }
  }

  const showNew = !loading && !!user && pathname !== '/projects' && pathname !== '/projects/new';
  const label = accountLabel(user?.email, isGuest, t);
  const initial = accountInitial(user?.email, isGuest);

  return (
    <header className="bg-[var(--surface-container-lowest)]">
      <div className="flex items-center gap-4 px-6 py-3 md:px-10">
        <Link
          href="/projects"
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" aria-hidden className="h-7 w-7 rounded-lg" />
          <span className="text-title tracking-tight text-[var(--on-surface)]">
            PromptMaster
          </span>
        </Link>

        {/* From inside a project too (Colette, 28 Oct: there was no way to start
            another one without going back to the list). Not on the list or the
            start, which have their own. */}
        {showNew && (
          <Link
            href="/projects/new"
            className="ms-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
            <span>{t('list.newProject')}</span>
          </Link>
        )}

        <div ref={wrapRef} className={`relative shrink-0 ${showNew ? '' : 'ms-auto'}`}>
          {/* Nothing is rendered while the session is still resolving, rather
              than an account control that says "Signed in" and then changes
              its mind a tick later. */}
          {!loading && (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label={t('header.account')}
              className="flex items-center gap-2 rounded-full bg-[var(--surface-container-low)] py-1.5 ps-1.5 pe-3 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--pm-primary)] text-label text-[var(--on-primary)]"
              >
                {initial ?? (
                  <span className="material-symbols-outlined text-[16px]">person</span>
                )}
              </span>
              <span className="hidden max-w-[180px] truncate sm:block">{label}</span>
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                expand_more
              </span>
            </button>
          )}

          {open && (
            <div
              role="menu"
              aria-label={t('header.account')}
              className="absolute end-0 z-50 mt-2 w-[248px] rounded-xl bg-[var(--surface-container-lowest)] py-2 shadow-lg shadow-black/10"
            >
              <div className="px-4 py-2">
                <p className="truncate text-body text-[var(--on-surface)]">{label}</p>
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">
                  {isGuest ? t('header.guestNote') : t('header.signedIn')}
                </p>
              </div>

              <div className="my-1 h-px bg-[var(--surface-container-high)]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => setColours((v) => !v)}
                aria-expanded={colours}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-body text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  palette
                </span>
                {t('header.colours')}
                <span aria-hidden className="material-symbols-outlined ms-auto text-[18px] text-[var(--on-surface-variant)]">
                  {colours ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {colours && <ColourPicker />}

              <button
                type="button"
                role="menuitem"
                onClick={() => setLanguage((v) => !v)}
                aria-expanded={language}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-body text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  translate
                </span>
                {t('header.language')}
                <span aria-hidden className="material-symbols-outlined ms-auto text-[18px] text-[var(--on-surface-variant)]">
                  {language ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {language && <LanguagePicker />}

              {confirmGuestOut && (
                <div role="alert" className="mx-2 mt-1 rounded-lg bg-[var(--surface-container-low)] px-3 py-2.5">
                  <p className="text-label text-[var(--on-surface)]">
                    {t('header.guestWarning')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push('/projects#save-account');
                        window.setTimeout(() => window.dispatchEvent(new Event(SAVE_ACCOUNT_EVENT)), 0);
                      }}
                      className="rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)]"
                    >
                      {t('header.createAccount')}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (isGuest && !confirmGuestOut) setConfirmGuestOut(true);
                  else void handleSignOut();
                }}
                disabled={busy}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-body text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)] disabled:opacity-60"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  logout
                </span>
                {busy ? t('header.signingOut') : confirmGuestOut ? t('header.signOutAnyway') : t('header.signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
