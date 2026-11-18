import { describe, expect, it } from 'vitest';

import { placeholderShare } from './placeholders';

// 18 Nov, Sean, Executive Search: a reusable template with no role brief yet.
const BLANK_BRIEF = `# Role brief and client instructions

| Field | Value |
| --- | --- |
| Role title | Not supplied |
| Client | Not supplied |
| Location | Not supplied |
| Reporting line | Not supplied |
| Compensation | To be confirmed |

Commitments: No timeline, no fee and no number of candidates is proposed.`;

const FILLED = `# Role brief

- Role title: President, Industrial Components
- Client: Northfield Manufacturing
- Location: Columbus, Ohio
- Reporting line: Board of directors
- Compensation: Not supplied`;

describe('a draft that is mostly placeholders', () => {
  it('reads a brief whose fields were not supplied as blank', () => {
    const r = placeholderShare(BLANK_BRIEF)!;
    expect(r.blanks).toBe(5);
    expect(r.share).toBeGreaterThanOrEqual(0.5);
  });
  it('reads a supplied brief with one gap as filled', () => {
    expect(placeholderShare(FILLED)!.share).toBeLessThan(0.5);
  });
  it('a record whose every row is not supplied, beside a column of guidance, is blank (18 Nov manual pass)', () => {
    const intake = ['# Client intake record', '', '| # | Field | Value | What belongs here |', '|---|---|---|---|',
      ...['Client name', 'Contact person', 'Industry', 'Annual revenue', 'Budget', 'Deadline', 'Scope', 'Decision maker', 'Success measure']
        .map((f, i) => `| ${i + 1} | ${f} | not supplied | What the client gives for ${f.toLowerCase()}. |`)].join('\n');
    expect(placeholderShare(intake)).toMatchObject({ blanks: 9, fields: 9, share: 1 });
  });
  it('a table of findings with one gap is not blank', () => {
    const rows = Array.from({ length: 10 }, (_, i) => `| C${i} | Met: "P&L owner" | ${i === 0 ? 'Not stated' : 'Met: "Runs 4 plants"'} |`);
    expect(placeholderShare(['| Candidate | R1 | R3 |', '|---|---|---|', ...rows].join('\n'))!.share).toBeLessThan(0.5);
  });
  it('a screening table full of "Not stated" and a task list of "Pending" are not blank', () => {
    const hold = Array.from({ length: 8 }, (_, i) => `| C${i} | Not stated | Met | Hold |`);
    expect(placeholderShare(['| Candidate | R1 | R2 | Verdict |', '|---|---|---|---|', ...hold].join('\n'))!.share).toBe(0);
    const tasks = Array.from({ length: 5 }, (_, i) => `| Task ${i} | Ana | Pending |`);
    expect(placeholderShare(['| Task | Owner | Status |', '|---|---|---|', ...tasks].join('\n'))!.share).toBe(0);
  });
  it('says nothing about text with too few fields', () => {
    expect(placeholderShare('A short paragraph with no fields.')).toBeNull();
  });
});
