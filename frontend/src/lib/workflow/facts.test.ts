import { describe, expect, it } from 'vitest';

import { assumedByModel, currentFacts, factSource, factsForRequest, factsText, replacedClause, retiredFacts, supersededFactValues } from './facts';
import { factValues } from './fact-values';
import { figureFindings, figureSources } from './figure-support';
import type { ProjectFact } from '@/types/project';

const fact = (over: Partial<ProjectFact>): ProjectFact => ({
  id: 'f1', project_id: 'p', user_id: 'u', statement: 'Candidate A has managed 100+ employees for 7 years', subject: null,
  kind: 'fact', source_kind: 'chat', source_ref: {}, accepted_by: 'user', agent_run_id: null, supersedes: null,
  retired_at: null, retired_reason: null, created_at: '2026-10-06T15:40:00Z', ...over,
});

describe('accepted facts (F1–F3, 7 Oct)', () => {
  const a = fact({ id: 'a', retired_at: '2026-10-07T09:00:00Z', retired_reason: 'superseded', statement: 'Candidate A: 6 years' });
  const a2 = fact({ id: 'a2', supersedes: 'a', source_kind: 'user_edit' });
  const req = fact({ id: 'r', kind: 'requirement', statement: 'Keep one researcher free for client work', source_kind: 'brief' });

  it('current is everything not retired; the history keeps what was replaced', () => {
    expect(currentFacts([a, a2, req]).map((f) => f.id)).toEqual(['a2', 'r']);
    expect(retiredFacts([a, a2, req]).map((f) => f.id)).toEqual(['a']);
  });

  it('a request carries each current fact with its source in words', () => {
    expect(factsForRequest([a, a2, req])).toEqual([
      { statement: 'Candidate A has managed 100+ employees for 7 years', subject: '', kind: 'fact', source: 'edited, 6 Oct', replaces: 'Candidate A: 6 years' },
      { statement: 'Keep one researcher free for client work', subject: '', kind: 'requirement', source: 'added to the brief, 6 Oct' },
    ]);
    expect(factSource(fact({ source_kind: 'file', source_ref: { name: 'candidates.pdf' } }))).toBe('from candidates.pdf, 6 Oct');
  });

  it('the change check sees the facts as one list, so a change reopens what relied on them', () => {
    expect(factsText([a, a2, req])).toBe('- Candidate A has managed 100+ employees for 7 years\n- Requirement: Keep one researcher free for client work');
  });

  it('a figure the user supplied as a fact is not "unsupported" (email 4)', () => {
    const saved = fact({ id: 's', statement: "Candidate A's last turnaround saved $4.5m in its first year" });
    const base = { objective: 'Choose the finalist', constraints: '', audience: '', output_format: '', context: '', data_files: [] };
    const text = 'Candidate A is recommended: the last turnaround saved $4.5m in its first year.';
    expect(figureFindings(text, figureSources({ ...base, facts: [] }, {}, 'final'))).toHaveLength(1);
    expect(figureFindings(text, figureSources({ ...base, facts: [saved] }, {}, 'final'))).toEqual([]);
  });
});

describe('supersededFactValues: a value another current fact states is still true (15 Oct, HARBOR)', () => {
  const asOf7 = fact({ id: 'd7', statement: 'Update Project HARBOR as of November 7, 2026.', retired_at: '2026-10-15T20:38:00Z', retired_reason: 'superseded' });
  const asOf8 = fact({ id: 'd8', statement: 'Update Project HARBOR as of November 8, 2026.', supersedes: 'd7' });
  const finished = fact({ id: 'r7', statement: 'Reconciliation actually finished November 7, 2026.' });

  it('November 7 is no leftover while reconciliation finished that day', () => {
    expect(supersededFactValues([asOf7, asOf8, finished])).toEqual([]);
  });

  it('without that fact, November 7 is what a repair must not still state', () => {
    expect(supersededFactValues([asOf7, asOf8]).map((s) => s.value)).toEqual(['11-7']);
  });
});

describe('a correction to a figure only the brief stated (18 Oct, Sean, Ridgeway)', () => {
  const revenue = fact({ id: 'r', statement: 'The CFO corrected current-quarter revenue to $27 million, superseding the earlier $30 million for the same quarter.' });
  const ebitda = fact({ id: 'e', statement: 'Revenue was $27 million, not $30 million. EBITDA was $3.6 million.' });

  it('tells every prompt what it replaces', () => {
    expect(factsForRequest([revenue])[0].replaces).toBe('the earlier $30 million for the same quarter');
    expect(factsForRequest([ebitda])[0].replaces).toBe('$30 million');
  });

  it('makes the old figure one a repair must not leave', () => {
    expect(supersededFactValues([revenue]).map((v) => v.value)).toEqual(factValues('$30 million').money);
    expect(supersededFactValues([ebitda]).map((v) => v.value)).toEqual(factValues('$30 million').money);
  });

  it('a fact that only states a figure replaces nothing', () => {
    expect(factsForRequest([fact({ id: 'x', statement: 'EBITDA was $3.6 million.' })])[0].replaces).toBeUndefined();
    expect(replacedClause('Hours are not 5 per week of effort')).toBeNull();
  });
});

describe('what the brief drafter assumed (S2b)', () => {
  const said = 'I need a quarterly operating review for the board. Revenue was $27 million.';
  it('a figure the user did not give, or words they did not use, are assumptions', () => {
    expect(assumedByModel('Revenue was $27 million.', said)).toBe(false);
    expect(assumedByModel('Margins were 14%.', said)).toBe(true);
    expect(assumedByModel('The review goes to the board each quarter.', said)).toBe(false);
    expect(assumedByModel('Include a competitor benchmarking appendix.', said)).toBe(true);
  });

  it('the provenance says so', () => {
    expect(factSource({ source_kind: 'chat', source_ref: { via: 'front door' }, created_at: '', accepted_by: 'user', origin: 'model_assumed' }))
      .toBe('from your conversation, assumed by PromptMaster (you did not say it)');
  });
});
