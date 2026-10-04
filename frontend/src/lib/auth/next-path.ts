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
