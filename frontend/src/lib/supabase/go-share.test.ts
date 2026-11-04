import { describe, expect, it } from 'vitest';

import { goShare } from './project-cost';

describe("Go's share of a project's calls (4 Nov: workflow actions apart from model calls)", () => {
  it('counts Go steps and the model calls made for them or for choosing them', () => {
    expect(goShare([
      { operation: 'go:plan', agent_step_id: null },
      { operation: 'go:evaluate_stage', agent_step_id: 's1' },
      { operation: 'go:evaluate_stage', agent_step_id: 's1' },
      { operation: 'go:revise_stage', agent_step_id: 's2' },
      { operation: '/api/chat-message', agent_step_id: null },
    ])).toEqual({ goSteps: 2, goCalls: 4 });
  });
});
