import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState, projectState } from '@/lib/workflow/engine';
import type { StageEvaluation, WorkflowEvent } from '@/lib/workflow/types';
import { buildAgentState } from './digest';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const evaluation = (id: string, unmet: StageEvaluation['unmet'] = []): StageEvaluation => ({
  stageId: id, canAdvance: unmet.every((c) => !c.blocking), criteria: unmet, unmet,
});
const event = (over: Partial<WorkflowEvent>): WorkflowEvent => ({
  stage_id: 'objective', type: 'stage_marked_complete', actor: 'user', created_at: '2026-09-29T00:00:00Z', ...over,
});

describe('buildAgentState: what the planner is told it cannot act on', () => {
  it('marks an optional criterion as optional, and a manual one as the user\'s', () => {
    const digest = buildAgentState({
      template: BOOK_V1, state: initialState(BOOK_V1), stage: stage('outline'), bundles: {}, steps: [],
      stageEvaluation: evaluation('outline', [
        { id: 'out.needs', label: 'Every audience need maps to a section', satisfied: false, blocking: false, manual: true },
        { id: 'out.sections', label: 'At least 3 sections', satisfied: false, blocking: true },
      ]),
    });
    expect(digest.criteria_unmet[0]).toBe(
      'Every audience need maps to a section (ticked by the user when satisfied — revising cannot satisfy it; optional — moving on does not need it; do not ask about it)'
    );
    expect(digest.criteria_unmet[1]).toBe('At least 3 sections');
  });

  it('says a left-open earlier stage is the user\'s to close', () => {
    const state = projectState(BOOK_V1, [
      event({ stage_id: 'objective', to_stage_id: 'audience' }),
      event({ stage_id: 'audience', to_stage_id: 'positioning' }),
      event({ stage_id: 'positioning', type: 'stage_advanced', to_stage_id: 'research' }),
    ]);
    const digest = buildAgentState({ template: BOOK_V1, state, stage: stage('research'), bundles: {}, steps: [], stageEvaluation: evaluation('research') });
    expect(digest.prior_stages).toEqual([
      'Objective and purpose: complete',
      'Audience: complete',
      'Positioning: left open (moved past; only the user can close it — nothing for you to do there)',
    ]);
  });
});
