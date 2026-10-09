import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { StepTimeline } from './step-timeline';
import type { AgentStep } from '@/types/agent';

const step = (id: string, action_key: string): AgentStep => ({
  id, run_id: 'r', user_id: 'u', project_id: 'p', idx: 0, stage_id: 'question', mode: 'architect', action_key, params: {},
  rationale: '', expected_outcome: '', needs_decision: false, decision_question: null, status: 'succeeded',
  execution_label: 'discussed', block_kind: null, tools_used: [], changes: {}, output: 'x', cost_usd: null, started_at: '', finished_at: '',
});

describe('repeated identical steps are one row with a count (2 Oct, screenshot 7)', () => {
  it('three identical steps fold into one row marked ×3; a different one stays its own row', () => {
    const { container } = render(<StepTimeline steps={[step('a', 'evaluate_stage'), step('b', 'evaluate_stage'), step('c', 'evaluate_stage'), step('d', 'prove')]} />);
    expect(container.querySelectorAll('li[data-step-status]')).toHaveLength(2);
    expect(container.querySelector('[data-repeats="3"]')?.textContent).toContain('×3');
  });
});
