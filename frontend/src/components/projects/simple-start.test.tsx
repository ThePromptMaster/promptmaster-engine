/**
 * The simple start (Sean, 18 Oct, email 7): a beta user found the start
 * overwhelming — too many questions, too much to read, and no telling whether
 * PromptMaster would do the work or hand him a prompt for ChatGPT.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SetupCard, DOES_THE_WORK, type SetupDraft } from './setup-card';
import type { WorkflowTemplate } from '@/lib/workflow/types';


const TEMPLATES = [
  { id: 't-so', key: 'single_output', name: 'Single output', description: 'x', version: 5, outline_stage: 'none', stages: [] },
  { id: 't-book', key: 'book', name: 'Book', description: 'y', version: 9, outline_stage: 'explicit', stages: [] },
] as unknown as (WorkflowTemplate & { id: string })[];

const DRAFT: SetupDraft = {
  title: 'Cookbook',
  objective: 'A cookbook of my family recipes, one page each',
  audience: 'General',
  constraints: 'Use only recipes the user supplies',
  output_format: '',
  context: '',
  mode: 'clarity',
};

function card(simple: boolean, templateId = 't-so') {
  return render(
    <SetupCard
      simple={simple}
      start={<button>Start Single output</button>}
      templates={TEMPLATES}
      templateId={templateId}
      onSelectTemplate={() => undefined}
      workflowReason="One finished document."
      recommendedKey="single_output"
      draft={DRAFT}
      rationale={{ mode: '', audience: '', constraints: 'Follows from what you said', output_format: '' }}
      onChange={() => undefined}
    />
  );
}

describe('SetupCard, simple', () => {
  it('shows what you will get and Start, with everything else folded under More options', () => {
    const { container } = card(true);
    expect(screen.getByRole('region', { name: 'What you will get' })).toHaveTextContent('Single output');
    expect(screen.getByRole('region', { name: 'What you will get' })).toHaveTextContent(DRAFT.objective);
    expect(screen.getByRole('button', { name: 'Start Single output' })).toBeVisible();
    expect(screen.getByText(new RegExp(DOES_THE_WORK.replace(/[.;]/g, '.')))).toBeInTheDocument();
    const more = container.querySelector('details[data-more-options]') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more).toHaveTextContent('How PromptMaster should think');
    // Suggested constraints are still pointed out: they become requirements on Start (10 Oct).
    expect(screen.getByText(/suggested some constraints you did not say/)).toBeInTheDocument();
  });

  it('describes the workflow chosen under More options, not the recommendation it replaced (19 Oct)', () => {
    card(true, 't-book');
    const got = screen.getByRole('region', { name: 'What you will get' });
    expect(got).toHaveTextContent('Book');
    expect(got).not.toHaveTextContent('Single output —');
    expect(got).not.toHaveTextContent('One finished document.');
    expect(got).toHaveTextContent('You chose this instead of the recommended Single output.');
  });

  it('advanced is the full setup, unchanged', () => {
    const { container } = card(false);
    expect(container.querySelector('details[data-more-options]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'What you will get' })).toBeNull();
    expect(screen.getByLabelText('How PromptMaster should think')).toBeVisible();
  });
});
