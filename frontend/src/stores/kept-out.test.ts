import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@/types/project';
import { keptOut } from './project-store';

/** 28 Oct (Sean, HarborDesk): the one place every stage version is saved keeps the user's removals. */

const PROMISE = 'Refunds are processed within 24 hours of the request.';
const v = (n: number, op: string, content: string, instruction = '') =>
  ({ version_number: n, source_operation: op, instruction, content, created_at: `2026-10-28T1${n}:00:00Z` }) as unknown as ArtifactVersion;
const stages = {
  draft: { artifact: null, versions: [v(1, 'stage_generate', `Welcome. ${PROMISE}`), v(2, 'chat_instruct', 'Welcome.', 'Remove the refund line.')] },
} as never;

describe('keptOut', () => {
  it('takes a removed sentence out of a version Go or a redraft wrote, and says so', () => {
    const out = keptOut(stages, { content: `Welcome. ${PROMISE} Bye.`, source_operation: 'agent_revise', change_summary: 'Redrafted.' });
    expect(out.content).toBe('Welcome. Bye.');
    expect(out.change_summary).toBe('Redrafted. Kept out a sentence you removed earlier.');
  });

  it('keeps it for the user’s own instruction that asks for it, never for Go’s', () => {
    const ask = 'Add a sentence saying refunds are processed within 24 hours.';
    expect(keptOut(stages, { content: `Welcome. ${PROMISE}`, source_operation: 'chat_instruct', instruction: ask }).content).toContain('Refunds');
    expect(keptOut(stages, { content: `Welcome. ${PROMISE}`, source_operation: 'agent_revise', instruction: ask }).content).toBe('Welcome.');
  });

  it('leaves the user’s own edit and a restore as they are', () => {
    for (const op of ['stage_edit', 'restore']) {
      const version = { content: `Welcome. ${PROMISE}`, source_operation: op };
      expect(keptOut(stages, version)).toBe(version);
    }
  });
});
