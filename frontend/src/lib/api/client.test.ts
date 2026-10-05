import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './client';

const getSession = vi.hoisted(() => vi.fn());
const refreshSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession, refreshSession } }),
}));

const INPUTS = {
  objective: 'o',
  audience: 'General',
  constraints: '',
  output_format: '',
  mode: 'architect' as const,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  } as Response;
}

function authed(token: string | null) {
  getSession.mockResolvedValue({ data: { session: token ? { access_token: token } : null } });
}

function lastAuthHeader(call: number) {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return (init.headers as Record<string, string>).Authorization;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockReset();
  refreshSession.mockReset();
  authed('tok-1');
});

describe('auth header', () => {
  it('attaches the access token as a bearer', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ system_prompt: '', user_prompt: '' }));
    await api.buildPrompt(INPUTS);
    expect(lastAuthHeader(0)).toBe('Bearer tok-1');
  });

  it('omits the header when there is no session', async () => {
    authed(null);
    fetchMock.mockResolvedValue(jsonResponse({ system_prompt: '', user_prompt: '' }));
    await api.buildPrompt(INPUTS);
    expect(lastAuthHeader(0)).toBeUndefined();
  });

  it('does not block the request when the auth layer throws', async () => {
    // The backend, not the client, decides whether a request is allowed.
    getSession.mockRejectedValue(new Error('storage unavailable'));
    fetchMock.mockResolvedValue(jsonResponse({ system_prompt: '', user_prompt: '' }));
    await expect(api.buildPrompt(INPUTS)).resolves.toBeDefined();
  });
});

describe('401 handling', () => {
  it('refreshes once and retries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ system_prompt: 'ok', user_prompt: '' }));
    refreshSession.mockImplementation(async () => {
      authed('tok-2');
      return { data: { session: { access_token: 'tok-2' } }, error: null };
    });

    await expect(api.buildPrompt(INPUTS)).resolves.toMatchObject({ system_prompt: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastAuthHeader(1)).toBe('Bearer tok-2');
  });

  it('gives up after one retry rather than looping', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, 401));
    refreshSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });

    await expect(api.buildPrompt(INPUTS)).rejects.toThrow('nope');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the refresh fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, 401));
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'revoked' } });

    await expect(api.buildPrompt(INPUTS)).rejects.toThrow('nope');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes only once for concurrent 401s', async () => {
    // Without single-flight, twenty parallel calls fire twenty refreshes and
    // race each other into a revoked-refresh-token loop.
    fetchMock.mockImplementation(async () =>
      refreshSession.mock.calls.length === 0
        ? jsonResponse({ detail: 'expired' }, 401)
        : jsonResponse({ system_prompt: 'ok', user_prompt: '' })
    );
    let resolveRefresh: (v: unknown) => void = () => {};
    refreshSession.mockImplementation(
      () => new Promise((r) => { resolveRefresh = r; })
    );

    const inflight = Promise.all([
      api.buildPrompt(INPUTS),
      api.buildPrompt(INPUTS),
      api.buildPrompt(INPUTS),
    ]);
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalled());
    resolveRefresh({ data: { session: { access_token: 't2' } }, error: null });
    await inflight;

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('errors', () => {
  it('throws a typed ApiError carrying the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'LLM error: boom' }, 502));
    await expect(api.buildPrompt(INPUTS)).rejects.toBeInstanceOf(ApiError);
    await expect(api.buildPrompt(INPUTS)).rejects.toMatchObject({
      status: 502,
      message: 'LLM error: boom',
    });
  });

  it('does not stringify a non-string detail into "[object Object]"', async () => {
    // FastAPI can return a structured detail; the old code did
    // `new Error(error.detail || ...)`, which rendered it as [object Object].
    fetchMock.mockResolvedValue(jsonResponse({ detail: { code: 'rate_limited' } }, 429));
    await expect(api.buildPrompt(INPUTS)).rejects.toThrow('API error: 429');
  });

  it('survives a non-JSON error body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 504,
      statusText: 'Gateway Timeout',
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(api.buildPrompt(INPUTS)).rejects.toMatchObject({ status: 504 });
  });
});

describe('a dropped connection (4 Oct, "Load failed")', () => {
  it('asks again once, and the caller gets the answer', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(jsonResponse({ system_prompt: 's', user_prompt: 'u' }));
    const pending = api.buildPrompt(INPUTS);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ system_prompt: 's', user_prompt: 'u' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('waits for the page to be visible again before asking (iOS suspends a hidden tab)', async () => {
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    fetchMock
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(jsonResponse({ system_prompt: 's', user_prompt: 'u' }));
    const pending = api.buildPrompt(INPUTS);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(pending).resolves.toEqual({ system_prompt: 's', user_prompt: 'u' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('a second drop says what happened in words', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Load failed'));
    const pending = api.buildPrompt(INPUTS);
    const settled = expect(pending).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/connection dropped/) });
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('a cancelled request is not retried', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(api.generateStageArtifact({} as never, controller.signal)).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
