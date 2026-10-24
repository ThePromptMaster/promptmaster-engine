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
    expect(q.at(-1)).toBe('What does this stage still need from me? (Not yet: I approve this plan)');
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

describe('the chips agree with the chat about what exists (14 Oct, Sean: wedding speech)', () => {
  const base = { renderer: 'prose' as const, stageLabel: 'Output', openRows: 0, nextStageLabel: 'Realign' };

  it('with nothing drafted, no chip names "An output exists"', () => {
    const chips = starterQuestions({ ...base, hasContent: false, requiredOpen: ['An output exists'] });
    expect(chips.join(' ')).not.toMatch(/An output exists/);
    expect(chips[0]).toBe('What should the Output stage produce for this project?');
  });

  it('an open criterion is said as not yet met', () => {
    const chips = starterQuestions({ ...base, hasContent: true, requiredOpen: ['The deliverable: at most 100 words'] });
    expect(chips).toContain('What does this stage still need from me? (Not yet: the deliverable: at most 100 words)');
  });
});

describe('in the interface language (24 Oct)', () => {
  it('asks in Arabic and Chinese, with the stage named as the page names it', async () => {
    const { translate } = await import('@/lib/i18n/translate');
    const input = { renderer: 'prose' as const, stageLabel: 'مراجعة', hasContent: true, openRows: 0, requiredOpen: [], nextStageLabel: 'المُخرَج' };
    const ar = starterQuestions(input, (k, v) => translate('ar', k, v));
    expect(ar).toEqual(['ما أضعف جزء في هذه المسودة؟', 'هل لا يزال هذا يخدم الهدف؟', 'هل هذا جاهز لمرحلة المُخرَج؟']);
    const zh = starterQuestions({ ...input, renderer: 'review', openRows: 2 }, (k, v) => translate('zh', k, v));
    expect(zh[0]).toBe('这 2 行待定内容中，哪些最重要？为什么？');
  });
});
