import { getLocale, tr } from '@/lib/i18n/store';

/**
 * Guest sign-in wording (14 Oct call: a tester "had trouble with the guest
 * sign-in … had to sign out", on a phone or tablet).
 *
 * Supabase's errors are written for developers. A guest who hits one is
 * deciding whether to try the product at all, so each known failure gets a
 * sentence that says what to do next — in the interface language (23 Oct).
 */
export function guestErrorMessage(raw: string): string {
  if (/rate limit|too many/i.test(raw)) {
    // Anonymous sign-ins are limited per IP address, and a phone network often
    // puts many people behind one address — so this is the mobile failure.
    return tr('auth.err.guestRate');
  }
  if (/anonymous/i.test(raw)) {
    // The project's anonymous provider can be turned off.
    return tr('auth.err.guestOff');
  }
  if (raw && getLocale() === 'en') return raw;
  return raw ? `${tr('auth.err.guest')} (${raw})` : tr('auth.err.guest');
}
