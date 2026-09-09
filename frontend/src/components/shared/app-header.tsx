'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';

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
function accountLabel(email: string | undefined, isGuest: boolean): string {
  if (isGuest) return 'Guest';
  return email ?? 'Signed in';
}

/** One glyph for the avatar disc — the first letter, or a person icon. */
function accountInitial(email: string | undefined, isGuest: boolean): string | null {
  if (isGuest) return null;
  const first = email?.trim()?.[0];
  return first ? first.toUpperCase() : null;
}

export function AppHeader() {
  const router = useRouter();
  const { user, loading, isGuest, signOut } = useAuth();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click-outside and Escape both close, because a menu that only closes by
  // pressing its own trigger again is a menu people leave open by accident.
  useEffect(() => {
    if (!open) return;

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

  const label = accountLabel(user?.email, isGuest);
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

        <div ref={wrapRef} className="relative ml-auto shrink-0">
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
              aria-label="Account"
              className="flex items-center gap-2 rounded-full bg-[var(--surface-container-low)] py-1.5 pl-1.5 pr-3 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
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
              aria-label="Account"
              className="absolute right-0 z-50 mt-2 w-[248px] rounded-xl bg-[var(--surface-container-lowest)] py-2 shadow-lg shadow-black/10"
            >
              <div className="px-4 py-2">
                <p className="truncate text-body text-[var(--on-surface)]">{label}</p>
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">
                  {isGuest
                    ? 'Work stays in this browser'
                    : 'Signed in'}
                </p>
              </div>

              <div className="my-1 h-px bg-[var(--surface-container-high)]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-body text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)] disabled:opacity-60"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  logout
                </span>
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
