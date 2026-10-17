import { describe, expect, it } from 'vitest';

import { markSuperseded, replacedValues } from './superseded-rows';
import type { StageItem } from './stage-artifact';
import type { ProjectFact } from '@/types/project';

const fact = (over: Partial<ProjectFact>): ProjectFact => ({
  id: 'f1', project_id: 'p', user_id: 'u', statement: '', subject: null, kind: 'requirement', source_kind: 'user_edit', source_ref: {},
  accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-10-17T15:14:00Z', ...over,
});

// 17 Oct (Sean, 20→12 project 7cd311ed): Final review v4 kept rows i2 and i10
// asserting "20 business days", accepted, beside i11 saying they were superseded.
const twelve = fact({ statement: 'Delivery must now be within 12 business days, replacing 20 business days.' });
const rows: StageItem[] = [
  { id: 'i2', finding: 'Each document explicitly states delivery within "20 business days".', status: 'accepted', status_source: 'user' },
  { id: 'i10', finding: 'The package uses "20 business days" consistently across all four documents.', status: 'accepted' },
  { id: 'i11', finding: 'Rows that refer to "20 business days" are superseded by the 12-day requirement.', status: 'accepted' },
  { id: 'i12', finding: 'Every document now states 12 business days.', status: 'accepted' },
  { id: 'i13', finding: 'The proposal mentions 20 business days in a footnote.' },
];

describe('a decided finding on a replaced value is kept and marked superseded', () => {
  it('reads the value a fact says it replaces', () => {
    expect(replacedValues([twelve]).map((v) => v.value)).toEqual(['20']);
  });

  it('marks i2 and i10, keeps their status, and leaves the current and undecided rows alone', () => {
    const out = markSuperseded(rows, replacedValues([twelve]));
    expect(out.filter((r) => r.superseded_by).map((r) => r.id)).toEqual(['i2', 'i10']);
    expect(out[0]).toMatchObject({ status: 'accepted', status_source: 'user', superseded_by: twelve.statement, finding: rows[0].finding });
    expect(out.slice(2)).toEqual(rows.slice(2));
  });

  it('does nothing when no fact replaced a value', () => {
    expect(markSuperseded(rows, replacedValues([fact({ statement: 'Delivery within 12 business days.' })]))).toEqual(rows);
  });
});
