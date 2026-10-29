/**
 * Getting from a successful sign-in to the page, every time (28 Oct: "Sign in
 * button sometimes doesn't work, then I press refresh and it does").
 *
 * Three ways the button did nothing until a refresh, each closed here or on the
 * page:
 * - A soft `router.push` after sign-in could leave the browser on the login
 *   page: the client router has no idea the cookie changed. A full navigation
 *   goes through the proxy, which reads the new session and lets them in.
 * - `signInWithPassword` waits on supabase-js's auth lock, which a slept tab or
 *   a token refresh in flight can hold indefinitely; the button sat on
 *   "Signing in…". It is now bounded, and a session that arrived anyway counts.
 * - A click before the page hydrated submitted the form natively. The page
 *   keeps the button disabled until it is ready, and the form posts, so a
 *   password never lands in the URL.
 */

export const SIGN_IN_TIMEOUT_MS = 15_000;

export class SignInTimeout extends Error {
  constructor() {
    super('Sign in timed out.');
    this.name = 'SignInTimeout';
  }
}

/** `work`, or a `SignInTimeout` after `ms`; the timer never outlives the race. */
export function withTimeout<T>(work: Promise<T>, ms: number = SIGN_IN_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SignInTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Leave the auth pages for `to` with a full page load, so the proxy and every
 * server render see the session that was just stored in cookies.
 */
export function goSignedIn(to: string): void {
  window.location.assign(to);
}
