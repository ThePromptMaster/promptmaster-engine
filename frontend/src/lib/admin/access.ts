/**
 * FR-19: who is allowed to see across every user's data.
 *
 * **This module must never be imported by a client component.** It reads
 * `ADMIN_USER_IDS`, which is deliberately not `NEXT_PUBLIC_`, so importing it
 * into a bundle would either inline the allowlist into shipped JavaScript or —
 * more likely — silently evaluate to an empty string and lock everyone out. It
 * is imported only by route handlers.
 *
 * ---
 *
 * **The decision that matters, stated plainly.**
 *
 * There is no role system in this product and this does not invent one. An
 * allowlist of user ids in an environment variable is proportionate to a
 * controlled beta with one product owner, and it has the property that matters:
 * changing who is an admin is a deployment setting, not a database write that
 * some other code path might make.
 *
 * The dangerous version of this feature — the one worth naming so it does not
 * get built later by accident — is a client-side `if (isAdmin)` wrapped around
 * a query. There are two variants and they fail differently:
 *
 *   - *Client check over an RLS-scoped query* returns nothing anyway, because
 *     RLS scopes to `auth.uid()`. Harmless, and useless.
 *   - *Client check over a service-role query* is a data breach. The
 *     service-role key bypasses RLS entirely, so the only thing standing
 *     between any logged-in user and every other user's projects is a boolean
 *     in JavaScript they can edit in a debugger.
 *
 * So the rule this file enforces: **the service-role key is only ever used
 * after this check has passed, on the server, in a route handler.** The admin
 * page itself holds no privilege at all — it is an ordinary client component
 * that fetches `/api/admin/overview` and renders whatever comes back. Point a
 * non-admin at it and they get a 403 and an explanation, because the refusal
 * happens where the data is, not where the buttons are.
 *
 * `error_events` and `model_usage` also have no cross-user RLS policy, on
 * purpose. Granting one would put a second, weaker copy of this decision in the
 * database — in the place where getting it wrong is a breach rather than an
 * empty page.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * The allowlist, parsed per call rather than at module load.
 *
 * Per call so that rotating it is an environment change and a restart, with no
 * chance of a long-lived lambda serving a stale list — and so a test can set it.
 */
export function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Is this user an admin?
 *
 * An empty allowlist denies everyone. That is the important half: an unset or
 * misspelled `ADMIN_USER_IDS` must fail closed, because the alternative — a
 * missing env var meaning "no restriction" — is how an admin page becomes
 * public on the one deploy where someone forgot to set it.
 */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allowed = adminUserIds();
  if (allowed.length === 0) return false;
  return allowed.includes(userId);
}

export interface AdminCaller {
  userId: string;
  email: string | null;
}

/**
 * Verify the bearer token and that its user is an admin.
 *
 * Returns the caller, or the `NextResponse` to return instead. The two-value
 * return is on purpose: it makes it impossible to "check" without also handling
 * the failure, which a boolean-returning helper would not.
 *
 * The token is verified by asking Supabase, not by decoding it here. A local
 * decode would need the JWT secret and would have to reimplement issuer,
 * audience and expiry checks that `auth.getUser` already does correctly — and
 * `backend/auth.py` exists as the cautionary example of how much detail that
 * actually involves.
 */
export async function requireAdmin(
  request: NextRequest
): Promise<AdminCaller | NextResponse> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json(
      { error: 'Sign in to view this page.' },
      { status: 401 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: 'Auth is not configured on this deployment.' },
      { status: 500 }
    );
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  if (!isAdminUserId(data.user.id)) {
    // 403, not 404. Unlike a project — where "not yours" and "does not exist"
    // are deliberately indistinguishable — the existence of an admin page is
    // not a secret, and telling a signed-in user plainly that they lack access
    // is more useful than pretending the route is missing.
    return NextResponse.json(
      { error: 'This page is limited to administrators.' },
      { status: 403 }
    );
  }

  return { userId: data.user.id, email: data.user.email ?? null };
}

/**
 * The service-role client. **Only ever call this after `requireAdmin` passed.**
 *
 * It bypasses RLS completely, which is precisely why the admin page can show
 * cross-user data at all — and precisely why the call order is not negotiable.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'The admin surface needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
