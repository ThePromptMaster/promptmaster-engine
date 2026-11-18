import { describe, expect, it } from 'vitest';

import { DEFAULT_SCALE, appendBatch, profileSlices, serializeAssessment } from './assess';
import { PROFILES_MAX, assessmentText, documentText } from './digest';

/**
 * 18 Nov (Sean, Executive Search Screening, f74d57a0): 29 candidates over three
 * batches. Shortlist v5's own check reported nine Advance candidates with
 * "Met at batch assessment; profile wording not held": the shortlist writer and
 * its repairs got each row as its first reason cut at 220 characters, with no
 * evidence, and the pasted profiles were kept nowhere.
 */
const PASTE = `Candidate 1: Nora Bennett
COO, Midwest valve maker, 9 plants, $640M revenue. P&L owner for 6 years. Led ERP rollout across all sites.

Candidate 2: Ethan Wallace
VP Operations, packaging. 3 plants. No P&L ownership stated.`;

const stage = { renderer: 'assess', id: 'screening', label: 'Batch screening', expected_artifacts: [] } as never;

describe('each row keeps its own part of the paste', () => {
  it('from its name to the next name', () => {
    const slices = profileSlices(PASTE, ['Nora Bennett', 'Ethan Wallace', 'Not In Paste']);
    expect(slices.get('Nora Bennett')).toBe('Candidate 1: Nora Bennett\nCOO, Midwest valve maker, 9 plants, $640M revenue. P&L owner for 6 years. Led ERP rollout across all sites.');
    expect(slices.get('Ethan Wallace')).toMatch(/^Candidate 2: Ethan Wallace\nVP Operations/);
    expect(slices.has('Not In Paste')).toBe(false);
  });
  it('appendBatch keeps it on the row', () => {
    const items = appendBatch([], [
      { id: 'c1', subject: 'Nora Bennett', verdict: 'Advance', rationale: '- Industrial manufacturing: met (valve maker)\n- P&L scale: met ($640M)', evidence: '"P&L owner for 6 years"', gaps: '' },
    ], 'now', PASTE);
    expect(items[0].profile).toContain('P&L owner for 6 years');
  });
});

describe('a later stage reads the evidence behind each verdict', () => {
  const items = appendBatch([], [
    { id: 'c1', subject: 'Nora Bennett', verdict: 'Advance', rationale: '- Industrial manufacturing: met (valve maker)\n- P&L scale: met ($640M)\n- ERP: met (rollout across all sites)', evidence: '"P&L owner for 6 years"; "Led ERP rollout across all sites"', gaps: '' },
    { id: 'c2', subject: 'Ethan Wallace', verdict: 'Hold', rationale: '- P&L: not stated', evidence: '', gaps: 'Does he own a P&L? The profile does not say whether his three plants report to him or to a division head, and the scale of the budget he runs is not given.' },
  ], 'now', PASTE);
  const text = documentText(stage, serializeAssessment(DEFAULT_SCALE, items));

  it('every reason, the evidence quoted, and gaps whole', () => {
    expect(text).toContain('Why: Industrial manufacturing: met (valve maker); P&L scale: met ($640M); ERP: met (rollout across all sites)');
    expect(text).toContain('Evidence: "P&L owner for 6 years"; "Led ERP rollout across all sites"');
    expect(text).toContain('and the scale of the budget he runs is not given.');
  });
  it('then the profiles as pasted, the rows going forward first', () => {
    expect(text).toContain('THE PROFILES AS PASTED');
    expect(text.indexOf('### Nora Bennett')).toBeLessThan(text.indexOf('### Ethan Wallace'));
  });
  it('profiles beyond the room are named as left out; the rows never are', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, subject: `Person ${i}`, verdict: 'Advance', profile: 'x'.repeat(3_000), rationale: '- ok', evidence: '"q"', gaps: '' }));
    const out = assessmentText(many);
    expect(out.match(/^\d+\. Person/gm)).toHaveLength(40);
    expect(out).toMatch(/more profiles not shown here for length/);
    expect(out.length).toBeLessThan(PROFILES_MAX + 40 * 200);
  });
});
