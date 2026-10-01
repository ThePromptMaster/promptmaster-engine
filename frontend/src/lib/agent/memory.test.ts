import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';
import { MEMORY_MAX_LINES, projectMemory } from './memory';

const event = (over: Partial<WorkflowEvent>): WorkflowEvent => ({ stage_id: 'research', type: 'stage_skipped', actor: 'user', created_at: '2026-10-01T00:00:00Z', ...over });
const step = (over: Partial<AgentStep>): AgentStep => ({
  id: Math.random().toString(), run_id: 'r', user_id: 'u', project_id: 'p', idx: 0, stage_id: 'audience', mode: 'architect',
  action_key: 'derive', params: {}, rationale: '', expected_outcome: '', needs_decision: false, decision_question: null,
  status: 'succeeded', execution_label: null, block_kind: null, tools_used: [], changes: {}, output: '', cost_usd: null,
  started_at: '', finished_at: '', ...over,
});

describe('projectMemory: what the planner is told has been decided (1 Oct, item 20)', () => {
  it('carries skips, overrides and reopenings with their reasons, by stage name', () => {
    const lines = projectMemory({
      template: BOOK_V1, recommendations: [], steps: [],
      events: [
        event({ type: 'stage_skipped', stage_id: 'research', reason: 'Not a commercial book' }),
        event({ type: 'stage_advanced', stage_id: 'positioning', reason: 'Will state the differentiator later' }),
        event({ type: 'stage_advanced', stage_id: 'audience' }), // no reason given: nothing to carry
        event({ type: 'stage_reopened', stage_id: 'objective' }),
        event({ type: 'stage_marked_complete', stage_id: 'objective' }),
      ],
    });
    const label = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!.label;
    expect(lines).toEqual([
      `Skipped ${label('research')}: Not a commercial book`,
      `Moved past ${label('positioning')} with something required still open, giving the reason: Will state the differentiator later`,
      `Reopened ${label('objective')} to change it`,
    ]);
  });

  it('carries priority decisions and suggestions taken or turned down, never the run\'s own authorization', () => {
    const lines = projectMemory({
      template: BOOK_V1, events: [], steps: [],
      recommendations: [
        { status: 'accepted', title: '"Make it longer" takes precedence over the constraints', category: 'conflict:1', scope: {} as never },
        { status: 'dismissed', title: 'Add a chapter on predators', category: 'scope', scope: {} as never },
        { status: 'accepted', title: 'Run Go mode autonomously', category: 'agent_authorization:autonomous', scope: { kind: 'agent_authorization' } as never },
        { status: 'pending', title: 'Still open', category: 'x', scope: {} as never },
      ],
    });
    expect(lines).toEqual([
      'Decided: "Make it longer" takes precedence over the constraints',
      'Turned down the suggestion: Add a chapter on predators',
    ]);
  });

  it('carries what the user answered, with the question, from this window and earlier ones', () => {
    const lines = projectMemory({
      template: BOOK_V1, events: [], recommendations: [],
      steps: [
        step({ action_key: 'request_user_decision', decision_question: 'Which audience should this be written for?' }),
        step({ action_key: 'user_answer', output: 'Ten-year-olds.' }),
      ],
    });
    expect(lines).toEqual(['Asked "Which audience should this be written for?", the user answered: Ten-year-olds.']);
  });

  it('keeps the most recent lines when there are many', () => {
    const events = Array.from({ length: 40 }, (_, i) => event({ reason: `reason ${i}` }));
    const lines = projectMemory({ template: BOOK_V1, events, recommendations: [], steps: [] });
    expect(lines).toHaveLength(MEMORY_MAX_LINES);
    expect(lines.at(-1)).toContain('reason 39');
  });
});
