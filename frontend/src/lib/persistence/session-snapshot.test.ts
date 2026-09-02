import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionSnapshot, flushSession } from './session-snapshot';
import { useSessionStore } from '@/stores/session-store';
import type { Iteration, LongFormState } from '@/types';

const saveSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/sessions', () => ({ saveSession }));

function iteration(n: number): Iteration {
  return {
    iteration_number: n,
    prompt_sent: `p${n}`,
    system_prompt_used: `s${n}`,
    output: `out${n}`,
    mode: 'architect',
    evaluation: null,
  };
}

beforeEach(() => {
  useSessionStore.getState().resetSession();
  saveSession.mockReset();
  saveSession.mockResolvedValue(undefined);
});

describe('buildSessionSnapshot', () => {
  it('returns null when there is nothing worth saving', () => {
    expect(buildSessionSnapshot()).toBeNull();
  });

  it("uses the store's sessionId rather than minting a new one", () => {
    // Regression: summary-phase used crypto.randomUUID() here, so finalizing a
    // session wrote a SECOND sessions row — a silent fork of the user's work —
    // and orphaned its chat history, which keys on the store id.
    useSessionStore.setState({ sessionId: 'abc12345', iterations: [iteration(1)] });
    expect(buildSessionSnapshot()?.session_id).toBe('abc12345');
  });

  it('falls back to a generated id with no hyphens when the store has none', () => {
    useSessionStore.setState({ sessionId: null, iterations: [iteration(1)] });
    const id = buildSessionSnapshot()!.session_id;
    // .slice(0,8) on a hyphenated uuid can include a '-'; the store strips them.
    expect(id).not.toContain('-');
    expect(id).toHaveLength(8);
  });

  it('carries long_form, which finalize used to drop', () => {
    const longForm: LongFormState = {
      state: 'complete',
      outline: [],
      current_section_index: 0,
      continuity_snapshot: null,
      started_at: '2026-09-02T00:00:00Z',
      completed_at: '2026-09-02T01:00:00Z',
    };
    useSessionStore.setState({
      sessionId: 'abc12345',
      iterations: [iteration(1)],
      longForm,
    });
    expect(buildSessionSnapshot()?.long_form).toEqual(longForm);
  });

  it('defaults finalized to the store flag so an autosave cannot un-finalize a session', () => {
    useSessionStore.setState({
      sessionId: 'abc12345',
      iterations: [iteration(1)],
      finalized: true,
    });
    expect(buildSessionSnapshot()?.finalized).toBe(true);
  });

  it('lets an explicit finalized argument win', () => {
    useSessionStore.setState({ sessionId: 'abc12345', iterations: [iteration(1)] });
    expect(buildSessionSnapshot(true)?.finalized).toBe(true);
  });

  it('captures the inputs the session was produced with', () => {
    useSessionStore.setState({
      sessionId: 'abc12345',
      iterations: [iteration(1), iteration(2)],
      objective: 'Plan a launch',
      audience: 'Engineers',
      constraints: 'Two weeks',
      outputFormat: 'Numbered list',
      mode: 'analyst',
      model: 'openai/gpt-5.4',
    });
    expect(buildSessionSnapshot()).toMatchObject({
      objective: 'Plan a launch',
      audience: 'Engineers',
      constraints: 'Two weeks',
      output_format: 'Numbered list',
      mode: 'analyst',
      model: 'openai/gpt-5.4',
    });
    expect(buildSessionSnapshot()!.iterations).toHaveLength(2);
  });
});

describe('flushSession', () => {
  it('writes the session for the given user', async () => {
    useSessionStore.setState({ sessionId: 'abc12345', iterations: [iteration(1)] });
    await flushSession('user-1');
    expect(saveSession).toHaveBeenCalledTimes(1);
    const [session, userId] = saveSession.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(session.session_id).toBe('abc12345');
  });

  it('does not write an empty session', async () => {
    await flushSession('user-1');
    expect(saveSession).not.toHaveBeenCalled();
  });

  it('propagates a write failure so the caller can decide', async () => {
    useSessionStore.setState({ sessionId: 'abc12345', iterations: [iteration(1)] });
    saveSession.mockRejectedValue(new Error('rls denied'));
    await expect(flushSession('user-1')).rejects.toThrow('rls denied');
  });
});
