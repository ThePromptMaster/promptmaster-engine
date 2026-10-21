/**
 * Guest sign-in wording (14 Oct call: a tester "had trouble with the guest
 * sign-in … had to sign out", on a phone or tablet).
 *
 * Supabase's errors are written for developers. A guest who hits one is
 * deciding whether to try the product at all, so each known failure gets a
 * sentence that says what to do next.
 */
export function guestErrorMessage(raw: string): string {
  if (/rate limit|too many/i.test(raw)) {
    // Anonymous sign-ins are limited per IP address, and a phone network often
    // puts many people behind one address — so this is the mobile failure.
    return 'Too many guest sessions have started from this network recently. Wait a few minutes and try again, or create a free account.';
  }
  if (/anonymous/i.test(raw)) {
    // The project's anonymous provider can be turned off.
    return 'Guest access is turned off for this workspace. Sign in or create an account to continue.';
  }
  return raw || 'Could not start a guest session.';
}
