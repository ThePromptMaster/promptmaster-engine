import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@/types/project';
import { appliedInstructions } from './applied-instructions';
import { withMeaningChanges, isNewFact } from './fact-reconcile';
import { inputsFrom } from './stage-requests';

const v = (n: number, op: string, instruction: string, at: string) =>
  ({ version_number: n, source_operation: op, instruction, created_at: at, content: `v${n}` }) as unknown as ArtifactVersion;

const template = { stages: [{ id: 'output', label: 'Output' }, { id: 'summary', label: 'Summary' }] } as never;

describe('appliedInstructions (12 Oct, Atlas)', () => {
  it('keeps what the user applied with Change it, oldest first, and nothing a stage or Go wrote', () => {
    const bundles = {
      output: { artifact: null, versions: [
        v(1, 'stage_generate', 'Draft it', '2026-10-11T10:00:00Z'),
        v(2, 'chat_instruct', 'Use S6 and S7; the permitted evidence is now S1–S7.', '2026-10-11T11:00:00Z'),
        v(3, 'agent_revise', 'RECHECK AFTER A CHANGE', '2026-10-11T12:00:00Z'),
        v(4, 'chat_save', 'Save the discussion as a new version', '2026-10-11T13:00:00Z'),
      ] },
      summary: { artifact: null, versions: [v(1, 'chat_instruct', 'Keep November 16 as the launch date.', '2026-10-11T11:30:00Z')] },
    };
    expect(appliedInstructions(template, bundles)).toEqual([
      { stage: 'Output', version: 2, instruction: 'Use S6 and S7; the permitted evidence is now S1–S7.', at: '2026-10-11T11:00:00Z' },
      { stage: 'Summary', version: 1, instruction: 'Keep November 16 as the launch date.', at: '2026-10-11T11:30:00Z' },
    ]);
  });

  it('goes out on every request built from the project', () => {
    const project = { objective: 'o', audience: 'a', constraints: '', output_format: '', mode: 'clarity', session_facts: [],
      applied_instructions: [{ stage: 'Output', version: 2, instruction: 'Use S1–S7.', at: 'x' }] } as never;
    expect(inputsFrom(project).user_instructions).toEqual([{ stage: 'Output', version: 2, instruction: 'Use S1–S7.' }]);
  });
});

describe('withMeaningChanges: standing changes an instruction states', () => {
  it('offers each as a new fact, even when the project has no facts yet', async () => {
    const out = await withMeaningChanges([], { facts: [], instruction: 'The permitted evidence is now S1–S7.', before: 'a', after: 'b' }, async () => ({
      changes: [], additions: [{ statement: 'Permitted evidence: S1–S7.', kind: 'requirement', quote: 'The permitted evidence is now S1–S7.' }],
    }));
    expect(out).toHaveLength(1);
    expect(isNewFact(out[0])).toBe(true);
    expect(out[0].proposed).toBe('Permitted evidence: S1–S7.');
    expect(out[0].fact.kind).toBe('requirement');
  });

  it('adds nothing for a hand edit, which has no instruction', async () => {
    const out = await withMeaningChanges([], { facts: [], instruction: '', before: 'a', after: 'b' }, async () => {
      throw new Error('not called');
    });
    expect(out).toEqual([]);
  });
});
