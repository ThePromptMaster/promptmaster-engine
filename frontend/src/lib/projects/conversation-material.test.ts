import { describe, expect, it } from 'vitest';

import { conversationMaterial } from './conversation-material';

/**
 * 20 Nov (Sean, warehouse rerun): "The package will flag that as a decision for
 * you" was PromptMaster's reply, and it came back from the setup as a requirement:
 * "must flag the zero-slack risk as a decision for the user".
 */
describe('the setup reads what the user said, never PromptMaster\'s replies', () => {
  const brief = {
    objective: 'Build a readiness package for a fictional warehouse scanner rollout.',
    audience: 'Warehouse leads',
    requirements: ['If the facts make the plan impossible, explain the shortfall and identify the decision needed.'],
    deliverables: ['Training schedule', 'Staff announcement'],
    stages: ['Feasibility', 'Package'],
    approvals: ['Operations director authorizes launch'],
  };
  const said = 'Build a readiness package… If the facts make the plan impossible, explain the shortfall and identify the decision needed.';

  it('carries the outline, the requirements and the user\'s own words', () => {
    const { objective, material } = conversationMaterial(brief, said);
    expect(objective).toBe(brief.objective);
    expect(material).toContain('Deliverables: Training schedule; Staff announcement');
    expect(material).toContain('Requirements the user stated or agreed: If the facts make the plan impossible');
    expect(material).toContain(`What the user said:\n${said}`);
  });

  it('has no PromptMaster turn in it', () => {
    const { material } = conversationMaterial(brief, said);
    expect(material).not.toMatch(/PromptMaster:|flag that as a decision for you/);
  });

  it('leaves out what is empty', () => {
    expect(conversationMaterial({ ...brief, audience: '', requirements: [], deliverables: [], stages: [], approvals: [] }, '').material).toBe('');
  });
});
