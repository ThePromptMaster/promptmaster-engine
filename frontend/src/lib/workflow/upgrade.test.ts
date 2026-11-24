import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { templateDiff } from './upgrade';

describe('templateDiff', () => {
  it('names the stages whose requirements changed', () => {
    const v2 = {
      ...BOOK_V1,
      version: 2,
      stages: BOOK_V1.stages.map((s) =>
        s.id === 'positioning'
          ? { ...s, exit_criteria: s.exit_criteria.map((c) => (c.id === 'pos.comparables' ? { ...c, check: 'auto' as const, hint: undefined } : c)) }
          : s
      ),
    };
    expect(templateDiff(v2, BOOK_V1)).toEqual({ added: [], removed: [], changed: ['Positioning'] });
  });

  it('names a renderer change — the Research v1 Experiment fix', () => {
    const v1 = { ...RESEARCH_V1, stages: RESEARCH_V1.stages.map((s) => (s.id === 'experiment' ? { ...s, renderer: 'list' as const } : s)) };
    expect(templateDiff(v1, RESEARCH_V1).changed).toContain(
      RESEARCH_V1.stages.find((s) => s.id === 'experiment')!.label
    );
  });

  it('reports added and removed stages by label', () => {
    const smaller = { ...BOOK_V1, stages: BOOK_V1.stages.filter((s) => s.id !== 'continuity') };
    const diff = templateDiff(smaller, BOOK_V1);
    expect(diff.added).toEqual([BOOK_V1.stages.find((s) => s.id === 'continuity')!.label]);
    expect(templateDiff(BOOK_V1, smaller).removed).toHaveLength(1);
  });
});

describe('templateDiff: wording apart from requirements (24 Nov pass)', () => {
  it('an edited instruction is reworded, not "requirements or layout updated"', () => {
    const v2 = { ...BOOK_V1, stages: BOOK_V1.stages.map((s, i) => (i === 0 ? { ...s, entry_prompt_hint: `${s.entry_prompt_hint ?? ''} Mark anything new.` } : s)) };
    const diff = templateDiff(BOOK_V1, v2);
    expect(diff.changed).toEqual([]);
    expect(diff.reworded).toEqual([BOOK_V1.stages[0].label]);
  });
});
