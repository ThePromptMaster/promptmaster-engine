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
  it('says nothing about text with too few fields', () => {
    expect(placeholderShare('A short paragraph with no fields.')).toBeNull();
  });
});
