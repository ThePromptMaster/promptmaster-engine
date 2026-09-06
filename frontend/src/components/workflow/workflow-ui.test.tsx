import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar } from './stage-transition-bar';
import { BOOK_V1, RESEARCH_V1, availableTransitions, evaluateStage, projectState } from '@/lib/workflow';
import type { CriterionResult, StageContext, WorkflowEvent } from '@/lib/workflow/types';

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: {},
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 0,
    findingsTriaged: 0,
    manualChecks: {},
    ...overrides,
  };
}

const ev = (
  type: WorkflowEvent['type'],
  stage_id: string,
  extra: Partial<WorkflowEvent> = {}
): WorkflowEvent => ({ type, stage_id, actor: 'user', created_at: '2026-09-04T00:00:00Z', ...extra });

describe('StageRail', () => {
  it('renders every stage of whichever template it is given', () => {
    const { unmount } = render(
      <StageRail
        template={BOOK_V1}
        state={projectState(BOOK_V1, [])}
        nextSuggestedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Objective/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fact-check/ })).toBeInTheDocument();
    unmount();

    // Same component, different workflow — no Book/Research branching anywhere.
    render(
      <StageRail
        template={RESEARCH_V1}
        state={projectState(RESEARCH_V1, [])}
        nextSuggestedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Hypothesis/ })).toBeInTheDocument();
  });

  it('groups stages so 13 items read as phases', () => {
    const { container } = render(
      <StageRail template={BOOK_V1} state={projectState(BOOK_V1, [])} nextSuggestedId={null} onSelect={vi.fn()} />
    );
    // Query the group headings specifically: some group labels collide with a
    // stage label of the same name ("Drafting" is both), so a text query would
    // match the button too.
    const headings = [...container.querySelectorAll('nav > div > div')].map(
      (el) => el.textContent?.trim()
    );
    for (const group of ['Planning', 'Outlining', 'Drafting', 'Evaluation', 'Final review']) {
      expect(headings).toContain(group);
    }
  });

  it('marks the current stage for assistive tech, not just visually', () => {
    render(
      <StageRail template={BOOK_V1} state={projectState(BOOK_V1, [])} nextSuggestedId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /Objective/ })).toHaveAttribute('aria-current', 'step');
  });

  it('surfaces a skip reason without making the user open the stage', () => {
    const state = projectState(BOOK_V1, [
      ev('stage_skipped', 'audience', { to_stage_id: 'positioning', reason: 'Writing for myself' }),
    ]);
    render(<StageRail template={BOOK_V1} state={state} nextSuggestedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Audience/ })).toHaveAttribute(
      'title',
      'Skipped — Writing for myself'
    );
  });

  it('flags stale work rather than hiding it', () => {
    const state = projectState(BOOK_V1, [
      ev('stage_completed', 'objective', { to_stage_id: 'audience' }),
      ev('stage_completed', 'audience', { to_stage_id: 'positioning' }),
      ev('stage_returned', 'positioning', { to_stage_id: 'objective' }),
    ]);
    render(<StageRail template={BOOK_V1} state={state} nextSuggestedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('selects a stage without moving the workflow cursor', async () => {
    const onSelect = vi.fn();
    render(
      <StageRail template={BOOK_V1} state={projectState(BOOK_V1, [])} nextSuggestedId={null} onSelect={onSelect} />
    );
    await userEvent.click(screen.getByRole('button', { name: /Critique/ }));
    expect(onSelect).toHaveBeenCalledWith('critique');
  });
});

describe('ExitCriteriaChecklist', () => {
  const criteria: CriterionResult[] = [
    { id: 'a', label: 'Objective is stated', satisfied: true, blocking: true },
    { id: 'b', label: 'At least two comparables', satisfied: false, blocking: false, detail: '1 of 2' },
    { id: 'c', label: 'Says what success looks like', satisfied: false, blocking: false },
  ];

  it('says what is missing rather than only that something is', () => {
    render(<ExitCriteriaChecklist criteria={criteria} manualIds={new Set(['c'])} onToggleManual={vi.fn()} />);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('lets the user tick a manual criterion but not a computed one', async () => {
    const onToggle = vi.fn();
    render(<ExitCriteriaChecklist criteria={criteria} manualIds={new Set(['c'])} onToggleManual={onToggle} />);

    const boxes = screen.getAllByRole('checkbox');
    // Only the manual criterion is interactive; the computed ones are derived
    // from project state and would be a lie if they were editable.
    expect(boxes).toHaveLength(1);

    await userEvent.click(boxes[0]);
    expect(onToggle).toHaveBeenCalledWith('c', true);
  });
});

describe('StageTransitionBar', () => {
  const stage = BOOK_V1.stages[0];

  function setup(context = ctx()) {
    const evaluation = evaluateStage(BOOK_V1, stage.id, context);
    const options = availableTransitions(BOOK_V1, projectState(BOOK_V1, []), evaluation);
    const onTransition = vi.fn();
    render(
      <StageTransitionBar stage={stage} evaluation={evaluation} options={options} onTransition={onTransition} />
    );
    return { onTransition };
  }

  it('never disables advancing, even with a blocking criterion unmet', () => {
    setup();
    // "Guidance is suggestive, not restrictive."
    const advance = screen.getByRole('button', { name: 'Advance anyway' });
    expect(advance).toBeEnabled();
  });

  it('says how much is outstanding', () => {
    setup();
    expect(screen.getByText(/outstanding/)).toBeInTheDocument();
  });

  it('advances without ceremony once criteria are met', async () => {
    const { onTransition } = setup(ctx({ fields: { objective: 'Write a book' } }));
    await userEvent.click(screen.getByRole('button', { name: 'Advance' }));
    // No note required when nothing is unmet.
    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it('asks why before advancing past unmet criteria, and lists them', async () => {
    const { onTransition } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Advance anyway' }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.getByText(/Moving on with unfinished items/)).toBeInTheDocument();
    expect(screen.getByText(/Objective is stated/)).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'Drafting the objective later');
    await userEvent.click(screen.getByRole('button', { name: 'Move on' }));
    expect(onTransition).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'advance' }),
      'Drafting the objective later'
    );
  });

  it('refuses to skip without a reason', async () => {
    const audience = BOOK_V1.stages[1];
    const evaluation = evaluateStage(BOOK_V1, audience.id, ctx());
    const options = availableTransitions(
      BOOK_V1,
      { current_stage_id: audience.id, stages: {} },
      evaluation
    );
    const onTransition = vi.fn();
    render(
      <StageTransitionBar stage={audience} evaluation={evaluation} options={options} onTransition={onTransition} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    // The database makes skip-without-reason unrepresentable; the UI mirrors
    // that rather than surfacing a constraint violation after the fact.
    expect(screen.getByRole('button', { name: 'Skip stage' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'I am writing for myself' }));
    expect(screen.getByRole('button', { name: 'Skip stage' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Skip stage' }));
    expect(onTransition).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skip' }),
      'I am writing for myself'
    );
  });

  it('warns that going back keeps later work', async () => {
    const critique = BOOK_V1.stages.find((s) => s.id === 'critique')!;
    const evaluation = evaluateStage(BOOK_V1, critique.id, ctx());
    const options = availableTransitions(
      BOOK_V1,
      { current_stage_id: critique.id, stages: {} },
      evaluation
    );
    render(
      <StageTransitionBar stage={critique} evaluation={evaluation} options={options} onTransition={vi.fn()} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    const menu = screen.getByText(/kept and flagged, not deleted/);
    expect(menu).toBeInTheDocument();
    expect(within(menu.parentElement!).getByRole('button', { name: /Return to Revision/ })).toBeInTheDocument();
  });

  it('offers Finish rather than Advance on the last stage', () => {
    const final = BOOK_V1.stages.at(-1)!;
    const evaluation = evaluateStage(BOOK_V1, final.id, ctx());
    const options = availableTransitions(
      BOOK_V1,
      { current_stage_id: final.id, stages: {} },
      evaluation
    );
    render(
      <StageTransitionBar stage={final} evaluation={evaluation} options={options} onTransition={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });
});
