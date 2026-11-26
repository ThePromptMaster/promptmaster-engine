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

describe('how PromptMaster should think: let it choose, or one way on every step (26 Nov, Sean)', () => {
  function withSpy(draft: SetupDraft) {
    const changes: Partial<SetupDraft>[] = [];
    const view = render(
      <SetupCard
        templates={TEMPLATES}
        templateId="t-so"
        onSelectTemplate={() => undefined}
        workflowReason=""
        recommendedKey="single_output"
        draft={draft}
        rationale={null}
        onChange={(patch) => changes.push(patch)}
      />
    );
    return { changes, select: screen.getByLabelText('How PromptMaster should think') as HTMLSelectElement, ...view };
  }

  it('lets PromptMaster choose by default, and says what a step with no way of its own uses', () => {
    const { select } = withSpy(DRAFT);
    expect(select.value).toBe('auto');
    expect(select.options[0].text).toBe('Let PromptMaster choose for each step (recommended)');
    expect(screen.getByText(/A step with none of its own uses Clarity/)).toBeInTheDocument();
  });

  it('a mode picked is used on every step, and PromptMaster\'s pick is kept to go back to', async () => {
    const { changes, select } = withSpy(DRAFT);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(select, { target: { value: 'critic' } });
    expect(changes.at(-1)).toEqual({ auto_mode: 'clarity', mode: 'critic', stage_modes: 'project' });
  });

  it('going back to "PromptMaster chooses" restores its pick as the fallback', async () => {
    const { changes, select } = withSpy({ ...DRAFT, mode: 'critic', stage_modes: 'project', auto_mode: 'clarity' });
    expect(select.value).toBe('critic');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(changes.at(-1)).toEqual({ mode: 'clarity', stage_modes: 'stage' });
  });
});
