import { describe, expect, it } from 'vitest';

import { describeVersionChange, versionChange } from './version-change';

describe('versionChange (19 Oct, Research › Method)', () => {
  const before = '## Method\n\nRun order: A then B.\n\n| Counter-result | Triggered by |\n\nStop at 40 sessions.';
  const after = '## Method\n\nRun order: A then B.\n\nStop at 40 sessions.\n\nMissing data: sessions under 5 minutes are excluded.';

  it('names the lines removed and added, not the ones kept', () => {
    expect(versionChange(before, after)).toEqual({
      removed: ['| Counter-result | Triggered by |'],
      added: ['Missing data: sessions under 5 minutes are excluded.'],
      more: 0,
    });
  });

  it('a moved line is not a change, and an unchanged text says so', () => {
    expect(versionChange('a\nb', 'b\na')).toEqual({ removed: [], added: [], more: 0 });
    expect(describeVersionChange(versionChange('same', 'same'))).toBe('The text did not change.');
  });

  it('is bounded, and says how many lines it left out', () => {
    const many = (p: string) => Array.from({ length: 10 }, (_, i) => `${p} ${i}`).join('\n');
    const c = versionChange(many('old'), many('new'), 6);
    expect(c.removed).toHaveLength(3);
    expect(c.added).toHaveLength(3);
    expect(c.more).toBe(14);
    expect(describeVersionChange(c)).toMatch(/^− old 0\n[\s\S]*\+ new 0[\s\S]*\(and 14 more changed lines\)$/);
  });
});
