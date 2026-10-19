import { describe, expect, it } from 'vitest';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { serializeItems } from '@/lib/workflow/stage-artifact';
import { returnInstruction, returningRows } from './return-work';

const stage = (id: string) => SINGLE_OUTPUT_V1.stages.find((s) => s.id === id)!;
const summary = stage('summary');
const output = stage('output');

// The shape of the FIELDGUIDE copy's Final review on 19 Oct (fr1…fr10): accepted fixes.
const rows = serializeItems([
  { id: 'fr1', text: 'The memo is over its limit. Cut the restated constraint list to one line.', status: 'accepted', status_source: 'policy' },
  { id: 'fr2', text: 'Role-player time is stated two ways. State 200 minutes once, labelled as an assumption.', status: 'accepted', status_source: 'policy' },
  { id: 'fr3', text: 'Who facilitates is not confirmed.', status: 'deferred', reason: 'Needs Dana', status_source: 'policy' },
]);

describe('returnInstruction', () => {
  it('carries a review stage’s rows back with the work, so the revision can apply them', () => {
    const text = returnInstruction(summary, rows, output, 'Go back to Output and apply the accepted fixes');
    expect(text).toContain('Go back to Output and apply the accepted fixes');
    expect(text).toContain('Cut the restated constraint list to one line');
    expect(text).toContain('State 200 minutes once');
    expect(text).toContain('Who facilitates is not confirmed');
    expect(text).toContain('Revise to take this in');
  });

  it('is the bare work when the returning stage holds no rows', () => {
    const text = returnInstruction(output, 'Some prose draft.', stage('input'), 'Tighten the objective');
    expect(text).toBe(`Further investigation asked for by ${output.label}: Tighten the objective\nRevise to take this in. Keep everything that still holds exactly as it is.`);
  });

  it('adds nothing for an empty table', () => {
    expect(returningRows(summary, serializeItems([]))).toBe('');
    expect(returningRows(summary, null)).toBe('');
  });
});
