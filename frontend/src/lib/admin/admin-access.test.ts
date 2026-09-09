/**
 * FR-19: the admin route must refuse a non-admin.
 *
 * This is the test that matters most in this lane, and it is written to fail
 * loudly if the check is ever removed or reordered. The specific disaster it
 * guards is narrow and worth naming: `/api/admin/overview` holds the
 * service-role key, which bypasses RLS completely. If the allowlist check were
 * moved below the query, or replaced by a client-side `if (isAdmin)`, then
 * every logged-in user could read every other user's projects, spend and
 * errors — and nothing else in the system would notice.
 *
 * So there are two layers of assertion here:
 *
 *   1. A non-admin gets a 403 and no data. The obvious one.
 *   2. The service-role client is never *constructed* for a caller who failed
 *      the check. That is the stronger property, because it holds even if
 *      someone later adds a query that forgets to check its own authorisation:
 *      the privileged client does not exist on that path at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
/** Records every `createClient` call so we can assert which key was used. */
const createClientSpy = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts?: unknown) => {
    createClientSpy(url, key, opts);
    return {
      auth: {
        getUser,
        admin: { listUsers: async () => ({ data: { users: [] }, error: null }) },
      },
      from: () => makeQuery(),
    };
  },
}));

/** A chainable PostgREST stub that always resolves to an empty result. */
function makeQuery() {
  const result = Promise.resolve({ data: [], error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'gte', 'in', 'order', 'limit', 'eq']) {
    chain[method] = () => chain;
  }
  // `await`ing the builder is what PostgREST does.
  chain.then = (...args: unknown[]) =>
    (result.then as (...a: unknown[]) => unknown)(...args);
  return chain;
}

const ANON_KEY = 'anon-key';
const SERVICE_KEY = 'service-role-key';

const ADMIN_ID = 'admin-user-0000';
const REGULAR_ID = 'regular-user-9999';

beforeEach(() => {
  vi.resetModules();
  getUser.mockReset();
  createClientSpy.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.ADMIN_USER_IDS = ADMIN_ID;
});

function request(token: string | null) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return {
    headers,
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as import('next/server').NextRequest;
}

function signedInAs(id: string, email = 'x@example.test') {
  getUser.mockResolvedValue({ data: { user: { id, email } }, error: null });
}

/** Was the privileged, RLS-bypassing client ever created? */
function serviceClientWasCreated(): boolean {
  return createClientSpy.mock.calls.some((call) => call[1] === SERVICE_KEY);
}

async function callRoute(token: string | null) {
  const { GET } = await import('@/app/api/admin/overview/route');
  return GET(request(token));
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

describe('the admin route refuses everyone who is not an admin', () => {
  it('refuses a signed-in user who is not on the allowlist', async () => {
    signedInAs(REGULAR_ID);
    const res = await callRoute('valid-token');

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/administrator/i);
    expect(body.usageByUser).toBeUndefined();
  });

  it('never even constructs the service-role client for a non-admin', async () => {
    signedInAs(REGULAR_ID);
    await callRoute('valid-token');

    expect(serviceClientWasCreated()).toBe(false);
  });

  it('refuses a request with no token at all', async () => {
    const res = await callRoute(null);

    expect(res.status).toBe(401);
    expect(serviceClientWasCreated()).toBe(false);
  });

  it('refuses a token Supabase rejects', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const res = await callRoute('forged-token');

    expect(res.status).toBe(401);
    expect(serviceClientWasCreated()).toBe(false);
  });

  it('refuses everyone when the allowlist is unset', async () => {
    // The important failure mode: a missing env var must not mean "no
    // restriction". That is how an admin page becomes public on the one deploy
    // where someone forgot to set it.
    delete process.env.ADMIN_USER_IDS;
    signedInAs(ADMIN_ID);
    const res = await callRoute('valid-token');

    expect(res.status).toBe(403);
    expect(serviceClientWasCreated()).toBe(false);
  });

  it('refuses everyone when the allowlist is empty or whitespace', async () => {
    process.env.ADMIN_USER_IDS = '  ,  , ';
    signedInAs(ADMIN_ID);

    expect((await callRoute('valid-token')).status).toBe(403);
    expect(serviceClientWasCreated()).toBe(false);
  });

  it('does not treat a prefix of an admin id as an admin', async () => {
    signedInAs(ADMIN_ID.slice(0, 8));
    expect((await callRoute('valid-token')).status).toBe(403);
  });

  it('verifies the token with the anon key, never the service key', async () => {
    // If the token were verified with the service-role client, an attacker who
    // could influence the client construction would be verifying against a
    // credential that bypasses RLS.
    signedInAs(REGULAR_ID);
    await callRoute('valid-token');

    expect(createClientSpy).toHaveBeenCalledWith(
      expect.any(String),
      ANON_KEY,
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// The admit
// ---------------------------------------------------------------------------

describe('the admin route admits an admin', () => {
  it('returns an overview to an allowlisted user', async () => {
    signedInAs(ADMIN_ID, 'owner@example.test');
    const res = await callRoute('valid-token');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toBeDefined();
    expect(Array.isArray(body.usageByUser)).toBe(true);
    expect(Array.isArray(body.failedJobs)).toBe(true);
  });

  it('uses the service-role client once the check has passed', async () => {
    signedInAs(ADMIN_ID);
    await callRoute('valid-token');

    expect(serviceClientWasCreated()).toBe(true);
  });

  it('accepts an id in a multi-entry allowlist, whitespace and all', async () => {
    process.env.ADMIN_USER_IDS = ` someone-else , ${ADMIN_ID} ,third `;
    signedInAs(ADMIN_ID);

    expect((await callRoute('valid-token')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The predicate on its own
// ---------------------------------------------------------------------------

describe('isAdminUserId', () => {
  it('fails closed on an unset allowlist', async () => {
    delete process.env.ADMIN_USER_IDS;
    const { isAdminUserId } = await import('./access');
    expect(isAdminUserId(ADMIN_ID)).toBe(false);
  });

  it('rejects null and empty ids even when the allowlist has entries', async () => {
    process.env.ADMIN_USER_IDS = `${ADMIN_ID},`;
    const { isAdminUserId } = await import('./access');
    expect(isAdminUserId(null)).toBe(false);
    expect(isAdminUserId(undefined)).toBe(false);
    expect(isAdminUserId('')).toBe(false);
  });

  it('admits an exact match', async () => {
    process.env.ADMIN_USER_IDS = ADMIN_ID;
    const { isAdminUserId } = await import('./access');
    expect(isAdminUserId(ADMIN_ID)).toBe(true);
  });
});
