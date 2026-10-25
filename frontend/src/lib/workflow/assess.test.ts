import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCALE,
  appendBatch,
  assessmentCsv,
  customScale,
  parseAssessment,
  scaleFromSpec,
  serializeAssessment,
  setVerdict,
  sortByVerdict,
  verdictCounts,
} from './assess';
import { parseItems } from './stage-artifact';
import { validateTemplate } from './validate';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { StageDefinition } from './types';

const row = (id: string, subject: string, verdict: string) => ({ id, subject, verdict, rationale: '- r', evidence: '', gaps: '' });

describe('assessing items in batches (client, 25 Oct)', () => {
  it('appends every batch, numbered, and keeps the model\'s verdict beside the user\'s', () => {
    const one = appendBatch([], [row('a', 'Jane', 'Green'), row('b', 'John', 'Red')], '2026-10-25T10:00:00Z');
    const two = appendBatch(one, [row('c', 'Ann', 'Amber')], '2026-10-25T11:00:00Z');
    expect(two.map((i) => [i.subject, i.batch])).toEqual([['Jane', '1'], ['John', '1'], ['Ann', '2']]);
    const changed = setVerdict(two, 'b', 'Amber');
    expect(changed[1]).toMatchObject({ verdict: 'Amber', model_verdict: 'Red', verdict_source: 'user' });
    expect(setVerdict(changed, 'b', 'Red')[1].verdict_source).toBe('model');
  });

  it('round-trips the scale with the rows, and reads as an ordinary table', () => {
    const items = appendBatch([], [row('a', 'Jane', 'Green')], 'now');
    const content = serializeAssessment(DEFAULT_SCALE, items);
    expect(parseAssessment(content)).toEqual({ scale: DEFAULT_SCALE, items });
    // Counts, digests and the chat read it with the shared parser.
    expect(parseItems(content)).toHaveLength(1);
    expect(parseAssessment('# prose')).toBeNull();
  });

  it('counts and sorts by the scale, best first, the ungraded last', () => {
    const items = [row('a', 'A', 'Red'), row('b', 'B', 'Green'), row('c', 'C', ''), row('d', 'D', 'Green')];
    expect(verdictCounts(DEFAULT_SCALE, items).map((c) => c.count)).toEqual([2, 0, 1, 1]);
    expect(sortByVerdict(DEFAULT_SCALE, items).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('makes a scale from the user\'s own lines, tones from good to bad', () => {
    const s = customScale('Shortlist\nHold\n\nhold\nDecline');
    expect(s.levels.map((l) => [l.label, l.tone])).toEqual([['Shortlist', 'good'], ['Hold', 'caution'], ['Decline', 'bad']]);
    expect(scaleFromSpec({ scale: 'pass_fail' }).levels.map((l) => l.label)).toEqual(['Pass', 'Fail']);
    expect(scaleFromSpec({ scale: 'nonsense' })).toBe(DEFAULT_SCALE);
  });

  it('writes CSV a spreadsheet cannot run', () => {
    const csv = assessmentCsv([{ id: 'a', subject: '=HYPERLINK("x")', verdict: 'Green', rationale: 'one, two' }], {
      subject: 'Item', verdict: 'Verdict', rationale: 'Why', evidence: 'Evidence', gaps: 'Not stated', batch: 'Batch', assessed_at: 'Assessed',
    });
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")",Green,"one, two",,,,`);
  });

  it('is a stage a workflow may hold, after the stage that sets the criteria', () => {
    const assess: StageDefinition = {
      ...SINGLE_OUTPUT_V1.stages[1], label: 'Assess', renderer: 'assess',
      expected_artifacts: [{ kind: 'assessments', cardinality: 'one' }], assess: { scale: 'traffic' },
    };
    const ok = { ...SINGLE_OUTPUT_V1, stages: SINGLE_OUTPUT_V1.stages.map((s, i) => (i === 1 ? assess : s)) };
    expect(validateTemplate(ok, { requireHints: false })).toEqual([]);
    const badScale = { ...ok, stages: ok.stages.map((s, i) => (i === 1 ? { ...s, assess: { scale: [{ label: 'Only', tone: 'good' as const }] } } : s)) };
    expect(validateTemplate(badScale, { requireHints: false }).join(' ')).toMatch(/scale that cannot be used/);
  });
});

describe('the Assess stage\'s count is checked by PromptMaster, not ticked (prod pass, 25 Oct)', () => {
  it('evaluates "at least one item" from the table', async () => {
    const { evaluateStage } = await import('./engine');
    const { ASSESSMENT_V1 } = await import('./templates/assessment.v1');
    const ctx = {
      fields: { objective: 'x' }, itemCounts: { assess: 0 }, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false,
      sections: {}, findings: {}, manualChecks: {},
    };
    const empty = evaluateStage(ASSESSMENT_V1, 'assess', ctx).criteria[0];
    expect(empty).toMatchObject({ satisfied: false });
    expect(empty.manual).toBeFalsy();
    expect(evaluateStage(ASSESSMENT_V1, 'assess', { ...ctx, itemCounts: { assess: 3 } }).criteria[0].satisfied).toBe(true);
  });
});
