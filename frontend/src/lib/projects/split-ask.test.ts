import { describe, expect, it } from 'vitest';
import { BRIEF_FROM_CHARS, DRAWN_OBJECTIVE_MAX, splitAsk } from './split-ask';

const facts = Array.from({ length: 60 }, (_, i) => `- Plant ${i + 1}: revenue $${(i + 1) * 3}m, margin ${i % 9}%`).join('\n');

describe('splitAsk (4 Oct, item 7)', () => {
  it('a short ask is the objective as it stands', () => {
    expect(splitAsk('  A book about giraffes.  ')).toEqual({ objective: 'A book about giraffes.', context: '' });
  });

  it('a long brief becomes the context, and its opening paragraph the objective', () => {
    const brief = `Northstar Precision Systems — board brief\n\nThe Board has asked management to determine why profitability has deteriorated despite revenue growth, decide what should be done, and produce a defensible 12-month plan.\n\n${facts}`;
    expect(brief.length).toBeGreaterThan(BRIEF_FROM_CHARS);
    const { objective, context } = splitAsk(brief);
    expect(objective).toMatch(/^The Board has asked management/);
    expect(context).toBe(brief);
  });

  it('an opening paragraph that is itself long is cut at a sentence', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} says something about the plan.`).join(' ');
    const { objective } = splitAsk(`${long}\n\n${facts}`);
    expect(objective.length).toBeLessThanOrEqual(DRAWN_OBJECTIVE_MAX);
    expect(objective.endsWith('.')).toBe(true);
  });
});
