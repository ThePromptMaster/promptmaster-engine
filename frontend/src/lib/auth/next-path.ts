/**
 * Where to send someone after they sign in, from a `?next=` parameter.
 *
 * Same-origin paths only: anything else (`https://…`, `//host`, `/\host`)
 * would turn the login page into an open redirect.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // Never back into the auth pages themselves, except the password reset.
  if (raw.startsWith('/auth') && !raw.startsWith('/auth/reset')) return null;
  return raw;
}

/** `?next=` from the current URL, for pages that read it at submit time. */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}

/**
 * Where someone was going when they left for Google or a confirmation email.
 *
 * The same reason as the reset below: production's redirect allow-list holds
 * `/auth/callback` exactly, so a `?next=` on the provider's return address may
 * not match. Until 6 Nov a link to an example or a project was simply lost by
 * signing in with Google or signing up. Local storage, not session storage: a
 * confirmation link opens in a new tab of this browser.
 */
const NEXT_KEY = 'pm-next-after-sign-in';
const NEXT_TTL_MS = 60 * 60 * 1000;

/** Nothing safe to remember clears what an abandoned sign-in left behind. */
export function rememberNext(raw: string | null | undefined): void {
  try {
    const next = safeNext(raw);
    if (next) localStorage.setItem(NEXT_KEY, JSON.stringify({ next, at: Date.now() }));
    else localStorage.removeItem(NEXT_KEY);
  } catch {
    /* storage unavailable: the callback falls back to the project list */
  }
}

/** Read once: a later sign-in on this browser starts clean. */
export function takeRememberedNext(): string | null {
  try {
    const raw = localStorage.getItem(NEXT_KEY);
    localStorage.removeItem(NEXT_KEY);
    if (!raw) return null;
    const { next, at } = JSON.parse(raw) as { next?: string; at?: number };
    return typeof at === 'number' && Date.now() - at < NEXT_TTL_MS ? safeNext(next) : null;
  } catch {
    return null;
  }
}

/**
 * A password reset this browser asked for, remembered until it is used.
 *
 * The reset email's link has to be on the Supabase redirect allow-list, and
 * production lists `/auth/callback` exactly — a `?next=` on it may not match,
 * and an unmatched link falls back to the site root (4 Oct). So the link is the
 * bare callback, and the intent lives here: the code exchange behind the link
 * needs this same browser anyway (its verifier is stored here too).
 */
const RESET_KEY = 'pm-reset-requested';
const RESET_TTL_MS = 60 * 60 * 1000;

export function rememberResetRequest(): void {
  try {
    localStorage.setItem(RESET_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: PASSWORD_RECOVERY still routes the link */
  }
}

export function resetWasRequested(): boolean {
  try {
    const at = Number(localStorage.getItem(RESET_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RESET_TTL_MS;
  } catch {
    return false;
  }
}

export function forgetResetRequest(): void {
  try {
    localStorage.removeItem(RESET_KEY);
  } catch {
    /* nothing to forget */
  }
}
