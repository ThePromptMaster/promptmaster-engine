import { describe, expect, it } from 'vitest';

import { documentInContext, replaceDocumentInContext } from './extract-text';
import { costByStage, OUTSIDE_GO_KEY, SECTIONS_KEY, stageOfStep } from '@/lib/supabase/project-cost';

describe('a new version of an attached document (17 Nov, Sean: "When a source changes …")', () => {
  const context = 'Notes from the call.\n\n### From pricing.docx\n\nPrice: $400.\nTerms: 30 days.\n\n### From team.pdf\n\nFive people.';
  it('its words replace the old ones where the context holds them, and nothing else moves', () => {
    expect(replaceDocumentInContext(context, 'pricing.docx', 'Price: $450.\nTerms: 45 days.\n')).toBe(
      'Notes from the call.\n\n### From pricing.docx\n\nPrice: $450.\nTerms: 45 days.\n\n### From team.pdf\n\nFive people.'
    );
    expect(replaceDocumentInContext(context, 'team.pdf', 'Six people.')).toBe('Notes from the call.\n\n### From pricing.docx\n\nPrice: $400.\nTerms: 30 days.\n\n### From team.pdf\n\nSix people.');
  });
  it('none when the context never held it', () => {
    expect(replaceDocumentInContext(context, 'other.pdf', 'x')).toBeNull();
  });
  it('the words a document holds there are read back, to see which lines changed (18 Nov)', () => {
    expect(documentInContext(context, 'pricing.docx')).toBe('Price: $400.\nTerms: 30 days.');
    expect(documentInContext(context, 'team.pdf')).toBe('Five people.');
    expect(documentInContext(context, 'other.pdf')).toBeNull();
  });
});

describe('what each stage cost (17 Nov, Sean: "which steps are driving the cost")', () => {
  it('Go\'s calls by the stage their step worked on; chapters written in the background; the rest outside Go', () => {
    const stageOf = stageOfStep([
      { id: 's1', stage_id: 'review', params: { stage_id: 'manuscript' } },
      { id: 's2', stage_id: 'review', params: {} },
    ]);
    const rows = [
      { cost_usd: '1.50', operation: 'go:recheck_stage', agent_step_id: 's1' },
      { cost_usd: 0.25, operation: 'go:evaluate_stage', agent_step_id: 's2' },
      { cost_usd: 2, operation: 'drain:repair', agent_step_id: null },
      { cost_usd: 0.1, operation: '/api/chat-message', agent_step_id: null },
      { cost_usd: null, operation: 'go:plan', agent_step_id: 's2' },
    ];
    expect(costByStage(rows, stageOf)).toEqual({ manuscript: 1.5, review: 0.25, [SECTIONS_KEY]: 2, [OUTSIDE_GO_KEY]: 0.1 });
  });
});
