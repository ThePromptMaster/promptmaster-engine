import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ProjectFact } from '@/lib/workflow/facts';

import { ProjectFacts } from './project-facts';

const fact = (over: Partial<ProjectFact>): ProjectFact => ({
  id: 'f1', project_id: 'p', user_id: 'u', statement: 'The rollout moved to November 20.', subject: null, kind: 'fact',
  source_kind: 'chat', source_ref: { via: 'side chat' }, accepted_by: 'user', agent_run_id: null, supersedes: null,
  retired_at: null, retired_reason: null, created_at: '2026-11-06T12:00:00Z', origin: 'user_stated',
  ...over,
} as ProjectFact);

function chip(f: ProjectFact): string {
  render(<ProjectFacts project={{ id: 'p', user_id: 'u', facts: [f] }} onChanged={vi.fn()} readOnly />);
  return screen.getByText(f.statement, { exact: false }).closest('li')?.textContent ?? document.body.textContent ?? '';
}

describe('where a fact came from, as a person reads it', () => {
  it('a report recorded from the chat says it was not verified', () => {
    expect(chip(fact({ source_ref: { via: 'side chat', reported: true } }))).toContain('reported and not verified');
  });

  it('a fact the user stated does not', () => {
    expect(chip(fact({}))).not.toContain('reported and not verified');
  });

  it('a choice left to Go says Go chose it, and not that it was the user\'s answer or an assumption', () => {
    const text = chip(fact({ origin: 'model_assumed', source_ref: { via: 'go answer', delegated: true } }));
    expect(text).toContain('chosen by Go when you left it to Go');
    expect(text).not.toContain('your answer to Go');
    expect(text).not.toContain('assumed by PromptMaster');
  });
});
