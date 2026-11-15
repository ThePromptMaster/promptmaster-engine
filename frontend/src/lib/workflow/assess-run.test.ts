// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ASSESS_CALL_MAX, DEFAULT_SCALE, appendBatch, batchAwaited, batchChunk, parseAssessment, restAfter, serializeAssessment } from './assess';
import { assessPaste, type BatchReply } from './assess-run';
import { documentText } from './digest';

/** 25 profiles pasted at once, as Sean did on 14 Nov. */
const profiles = Array.from({ length: 25 }, (_, i) => `Candidate ${i + 1}\nVP Operations, Acme ${i + 1}\nManufacturing, P&L of ${i + 10}M.`);
const paste = profiles.join('\n\n');

/** A server that judges twelve at a time and says where it stopped, like assessment.py. */
function fakeServer() {
  return vi.fn(async (chunk: string, already: string[]): Promise<BatchReply> => {
    const names = [...chunk.matchAll(/^Candidate \d+$/gm)].map((m) => m[0]);
    const todo = names.filter((n) => !already.includes(n));
    const judged = todo.slice(0, 12);
    const left = todo.slice(12);
    return {
      items: judged.map((n) => ({ id: `id-${n}`, subject: n, verdict: 'Green', rationale: '- Meets the bar', evidence: '', gaps: '' })),
      ungraded: 0,
      not_assessed: left.length,
      next_from: left[0] ?? '',
      already_in_table: names.length - todo.length,
    };
  });
}

describe('a paste of any size is judged a batch at a time (15 Nov, Sean: 25 pasted, 12 judged, 13 lost)', () => {
  it('judges all 25 in three calls, saving after each, with nothing left over', async () => {
    const call = fakeServer();
    const saves: number[] = [];
    const progress: number[] = [];
    const run = await assessPaste({
      text: paste,
      existing: [],
      call,
      save: async (items) => {
        saves.push(items.length);
      },
      onProgress: (n) => progress.push(n),
      now: () => 'now',
    });
    expect(run.items.map((i) => i.subject)).toEqual(profiles.map((p) => p.split('\n')[0]));
    expect(run.added).toBe(25);
    expect(run.pending).toBeNull();
    expect(call).toHaveBeenCalledTimes(3);
    expect(saves).toEqual([12, 24, 25]);
    expect(progress).toEqual([12, 24, 25]);
  });

  it('keeps what it could not reach, for "Assess the remaining N", and Go is offered it', async () => {
    const lost = vi.fn(async (): Promise<BatchReply> => ({
      items: [{ id: 'x', subject: 'Candidate 1', verdict: 'Green', rationale: '', evidence: '', gaps: '' }],
      ungraded: 0,
      not_assessed: 24,
      next_from: 'Somebody not in the paste',
    }));
    let saved = '';
    const run = await assessPaste({
      text: paste,
      existing: [],
      call: lost,
      save: async (items, pending) => {
        saved = serializeAssessment(DEFAULT_SCALE, items, pending);
      },
    });
    expect(run.pending).toEqual({ text: paste, count: 24 });
    expect(parseAssessment(saved)?.pending?.count).toBe(24);
    expect(batchAwaited({ renderer: 'assess' }, saved)).toEqual({ offered: true, noun: null });
  });

  it('never adds a name twice, whether carried on or pasted again', () => {
    const once = appendBatch([], [{ id: 'a', subject: 'Jane Doe', verdict: 'Green', rationale: '', evidence: '', gaps: '' }], 'now');
    const again = appendBatch(once, [{ id: 'b', subject: 'jane  doe.', verdict: 'Red', rationale: '', evidence: '', gaps: '' }], 'now');
    expect(again).toHaveLength(1);
  });

  it('cuts a call at a blank line, and finds where the next one starts', () => {
    const long = Array.from({ length: 400 }, (_, i) => `Profile ${i}\n${'x'.repeat(150)}`).join('\n\n');
    const chunk = batchChunk(long);
    expect(chunk.length).toBeLessThanOrEqual(ASSESS_CALL_MAX);
    expect(long.startsWith(chunk)).toBe(true);
    expect(long.slice(chunk.length).startsWith('\n\n')).toBe(true);
    expect(restAfter('A\n\nB  one\n\nC', 'A\n\nB  one\n\nC', { not_assessed: 2, next_from: 'B one' })).toBe('B  one\n\nC');
    expect(restAfter('A\n\nB', 'A', { not_assessed: 0 })).toBe('B');
    expect(restAfter('A', 'A', { not_assessed: 0 })).toBe('');
    expect(restAfter('A\n\nB', 'A\n\nB', { not_assessed: 1, next_from: 'Z' })).toBeNull();
  });

  it('hands a later stage everyone, one line each', () => {
    const items = appendBatch([], [{ id: 'a', subject: 'Jane Doe', verdict: 'Green', rationale: '- Ran a 40M P&L\n- Plant manager', evidence: '', gaps: 'No ERP' }], 'now');
    const text = documentText({ renderer: 'assess', id: 's', label: 'Score', expected_artifacts: [] } as never, serializeAssessment(DEFAULT_SCALE, items));
    expect(text).toBe('1 assessed:\n1. Jane Doe — Green — Ran a 40M P&L (gaps: No ERP)');
  });
});
