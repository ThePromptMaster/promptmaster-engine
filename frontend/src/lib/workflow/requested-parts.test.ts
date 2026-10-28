import { describe, expect, it } from 'vitest';
import { missingParts } from './requested-parts';

/** 28 Oct (Sean, HarborDesk test): "one requested change log was missing". */

const project = (over: Record<string, unknown> = {}) =>
  ({ objective: 'A support playbook', constraints: '', output_format: '', facts: [], applied_instructions: [], ...over }) as never;

describe('missingParts', () => {
  it('names a change log asked for in an instruction and missing from the work', () => {
    const p = project({ applied_instructions: [{ stage: 'Draft', version: 3, instruction: 'Add a short change log at the end.', at: 'x' }] });
    expect(missingParts(p, 'The playbook text.')).toEqual(['change log']);
  });

  it('is satisfied by the part under its own name or a changes heading', () => {
    const p = project({ constraints: 'Include a change log.' });
    expect(missingParts(p, 'Text.\n\nChange log: hours corrected.')).toEqual([]);
    expect(missingParts(p, 'Text.\n\n## What changed\n\n- Hours corrected.')).toEqual([]);
  });

  it('reads accepted requirements, not retired ones', () => {
    const fact = (retired_at: string | null) => ({ kind: 'requirement', statement: 'The pack needs a cover note.', retired_at });
    expect(missingParts(project({ facts: [fact(null)] }), 'Pack.')).toEqual(['cover note']);
    expect(missingParts(project({ facts: [fact('2026-10-28')] }), 'Pack.')).toEqual([]);
  });

  it('does not ask for what the user declined, or later took back', () => {
    expect(missingParts(project({ constraints: 'No executive summary.' }), 'Text.')).toEqual([]);
    const later = project({
      constraints: 'Include a glossary.',
      applied_instructions: [{ stage: 'Draft', version: 2, instruction: 'Remove the glossary.', at: 'x' }],
    });
    expect(missingParts(later, 'Text.')).toEqual([]);
  });

  it('says nothing about an empty work or a request for none of these', () => {
    expect(missingParts(project({ constraints: 'Include a change log.' }), '')).toEqual([]);
    expect(missingParts(project(), 'Text.')).toEqual([]);
  });
});
