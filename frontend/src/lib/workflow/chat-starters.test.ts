import { describe, expect, it } from 'vitest';

import { STARTERS_MAX, starterQuestions } from './chat-starters';

const base = { stageLabel: 'Continuity', hasContent: true, openRows: 0, requiredOpen: [], nextStageLabel: 'Revision' };

describe('the chat opens on the question the page poses (3 Oct call)', () => {
  it('asks about the open rows on a check stage', () => {
    const q = starterQuestions({ ...base, renderer: 'review', openRows: 3 });
    expect(q[0]).toBe('Which of the 3 open rows matter most, and why?');
    expect(q).toContain('Is this ready for Revision?');
  });

  it('names what the stage still needs before suggesting moving on', () => {
    const q = starterQuestions({ ...base, renderer: 'prose', requiredOpen: ['I approve this plan'] });
    expect(q.at(-1)).toBe('What does this stage still need from me? (I approve this plan)');
  });

  it('asks what to produce on an empty stage', () => {
    expect(starterQuestions({ ...base, renderer: 'prose', hasContent: false })[0]).toMatch(/What should the Continuity stage produce/);
  });

  it('asks about chapters and outlines in their own terms, never more than three', () => {
    for (const renderer of ['outline', 'long_form', 'prose', 'list', 'review'] as const) {
      expect(starterQuestions({ ...base, renderer, openRows: 2, requiredOpen: ['x'] }).length).toBeLessThanOrEqual(STARTERS_MAX);
    }
    expect(starterQuestions({ ...base, renderer: 'long_form' })[0]).toMatch(/chapter/);
  });
});
