import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@/types/project';
import { keepUnasked } from './preservation';
import { notRemovedByUser, removedByUser, sentencesRemoved } from './removed-text';
import { inputsFrom } from './stage-requests';

/**
 * 28 Oct (Sean, HarborDesk test): "a sentence explicitly removed during
 * revision returned later".
 */

const v = (n: number, op: string, content: string, instruction = '') =>
  ({ version_number: n, source_operation: op, instruction, content, created_at: `2026-10-28T1${n}:00:00Z` }) as unknown as ArtifactVersion;

const template = { stages: [{ id: 'draft', label: 'Draft' }] } as never;

const PROMISE = 'Refunds are processed within 24 hours of the request.';
const V1 = `Welcome to HarborDesk support. ${PROMISE} Agents answer chats from 8 a.m. to 8 p.m.`;
const V2 = 'Welcome to HarborDesk support. Agents answer chats from 8 a.m. to 8 p.m.';

describe('removedByUser', () => {
  it('records a sentence an instruction asked to remove', () => {
    const bundles = { draft: { artifact: null, versions: [v(1, 'stage_generate', V1), v(2, 'chat_instruct', V2, 'Remove the refund promise.')] } };
    expect(removedByUser(template, bundles).map((r) => [r.stage, r.sentence])).toEqual([['Draft', PROMISE]]);
  });

  it('records what a direct edit took out', () => {
    const bundles = { draft: { artifact: null, versions: [v(1, 'stage_generate', V1), v(2, 'stage_edit', V2)] } };
    expect(removedByUser(template, bundles).map((r) => r.sentence)).toEqual([PROMISE]);
  });

  it('keeps it on the list when a later draft wrote it again', () => {
    const bundles = { draft: { artifact: null, versions: [
      v(1, 'stage_generate', V1), v(2, 'chat_instruct', V2, 'Take the refund line out.'), v(3, 'agent_revise', V1),
    ] } };
    expect(removedByUser(template, bundles).map((r) => r.sentence)).toEqual([PROMISE]);
  });

  it('takes it off when the user brings it back themselves', () => {
    const bundles = { draft: { artifact: null, versions: [
      v(1, 'stage_generate', V1), v(2, 'chat_instruct', V2, 'Remove the refund promise.'), v(3, 'stage_edit', V1),
    ] } };
    expect(removedByUser(template, bundles)).toEqual([]);
  });

  it('records nothing for a shortening, a rewrite or a version Go made', () => {
    for (const [op, instruction] of [['chat_instruct', 'Shorten it.'], ['chat_instruct', 'Rewrite it more formally.'], ['agent_revise', 'Remove it']]) {
      const bundles = { draft: { artifact: null, versions: [v(1, 'stage_generate', V1), v(2, op, V2, instruction)] } };
      expect(removedByUser(template, bundles)).toEqual([]);
    }
  });

  it('does not count a sentence reworded rather than removed', () => {
    expect(sentencesRemoved(V1, V2.replace('Welcome', 'Welcome') + ' Refunds are processed within one day of the request.')).toEqual([]);
  });

  it('goes out on every request built from the project', () => {
    const project = { objective: 'o', audience: 'a', constraints: '', output_format: '', mode: 'clarity', session_facts: [],
      removed_text: [{ stage: 'Draft', stageId: 'draft', sentence: PROMISE, at: 'x' }] } as never;
    expect(inputsFrom(project).removed_text).toEqual([{ stage: 'Draft', sentence: PROMISE }]);
  });
});

describe('preservation never puts a removed sentence back', () => {
  it('when a later revision drops it again', () => {
    const before = `- ${PROMISE}\n- Agents answer chats from 8 a.m. to 8 p.m.`;
    const after = '- Agents answer chats from 8 a.m. to 8 p.m.';
    expect(keepUnasked(before, after, 'Use a friendlier greeting').restored).toEqual([`- ${PROMISE}`]);
    const kept = keepUnasked(before, after, 'Use a friendlier greeting', notRemovedByUser([{ sentence: PROMISE }]));
    expect(kept.restored).toEqual([]);
    expect(kept.text).not.toContain('Refunds');
  });

  it('treats "leave out" as asking for a removal', () => {
    const before = `- ${PROMISE}\n- Agents answer chats from 8 a.m. to 8 p.m.`;
    expect(keepUnasked(before, '- Agents answer chats from 8 a.m. to 8 p.m.', 'Leave out the refund line').restored).toEqual([]);
  });
});
