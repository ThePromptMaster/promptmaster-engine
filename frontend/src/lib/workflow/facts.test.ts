import { describe, expect, it } from 'vitest';

import { currentFacts, factSource, factsForRequest, factsText, retiredFacts } from './facts';
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
      { statement: 'Candidate A has managed 100+ employees for 7 years', subject: '', kind: 'fact', source: 'edited, 6 Oct' },
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
