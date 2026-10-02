import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar } from './stage-transition-bar';
import { CompletionDialog } from './stage-status-panels';
import { ProjectFinishedBanner } from './project-finished-banner';
import { ProjectFinished } from './project-finished';
import { StageRenderer } from './renderers/stage-renderer';
import {
  BOOK_V1,
  RESEARCH_V1,
  SINGLE_OUTPUT_V1,
  availableTransitions,
  deliverableStage,
  initialState,
  evaluateStage,
  getStage,
  projectState,
} from '@/lib/workflow';
import { itemSchemaFor, serializeItems } from '@/lib/workflow/stage-artifact';
import type { CriterionResult, StageContext, WorkflowEvent } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

/** A version row carrying whatever content a renderer is being handed. */
function researchVersion(content: string): ArtifactVersion {
  return {
    id: 'v1',
    user_id: 'u1',
    project_id: 'p1',
    artifact_id: 'a1',
    version_number: 1,
    parent_version_id: null,
    source_operation: 'stage_draft',
    instruction: '',
    system_prompt: '',
    content,
    model: 'test/model',
    mode: 'architect',
    change_summary: null,
    restored_from_version_id: null,
    finish_reason: 'stop',
    user_rating: null,
    continuity_snapshot: null,
    created_at: '2026-09-04T00:00:00Z',
  };
}

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: {},
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sections: {},
    findings: {},
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

  it('draws every Research stage with a renderer Book already uses', () => {
    // The FR-03 claim, asserted rather than asserted-about: Research adds no
    // renderer of its own, so the set it needs is a subset of Book's. If this
    // fails, someone has answered a Research requirement with a new component
    // instead of new data.
    const bookRenderers = new Set(BOOK_V1.stages.map((s) => s.renderer));
    for (const stage of RESEARCH_V1.stages) {
      expect(bookRenderers, `${stage.id}`).toContain(stage.renderer);
    }
  });

  it('renders a Research stage through the same StageRenderer dispatch', () => {
    // Not a claim about the template — the component is mounted with Research
    // data and asked to draw it. The fields come from the item schema, so a
    // hypothesis row is an audience row with different columns.
    const hypothesis = getStage(RESEARCH_V1, 'hypothesis')!;
    render(
      <StageRenderer
        stage={hypothesis}
        schema={itemSchemaFor(hypothesis)}
        versions={[researchVersion(serializeItems([{ id: 'i1', statement: 'Latency drives churn' }]))]}
        activeVersionId={null}
        onSelectVersion={vi.fn()}
        onRestore={vi.fn(async () => {})}
        onSaveContent={vi.fn(async () => {})}
        onSaveItems={vi.fn(async () => {})}
        generating={false}
        generationError={null}
        onGenerate={vi.fn()}
        onCancelGeneration={vi.fn()}
        readOnly={false}
      />
    );
    expect(screen.getByLabelText('Statement')).toHaveValue('Latency drives churn');
    expect(screen.getByLabelText('What would show it false')).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/)).not.toBeInTheDocument();
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
    expect(screen.getByText('recheck')).toBeInTheDocument();
  });

  it('a stage left open is not drawn as the stage you are on (1 Oct, item 1)', () => {
    const state = projectState(BOOK_V1, [
      ev('stage_marked_complete', 'objective', { to_stage_id: 'audience' }),
      ev('stage_marked_complete', 'audience', { to_stage_id: 'positioning' }),
      ev('stage_advanced', 'positioning', { to_stage_id: 'research' }),
    ]);
    render(<StageRail template={BOOK_V1} state={state} nextSuggestedId={null} onSelect={vi.fn()} />);
    const leftOpen = screen.getByRole('button', { name: /Positioning/ });
    const current = screen.getByRole('button', { name: /Research/ });
    expect(leftOpen).toHaveTextContent('left open');
    expect(leftOpen.querySelector('.material-symbols-outlined')).toHaveTextContent('pending');
    expect(current.querySelector('.material-symbols-outlined')).toHaveTextContent('radio_button_checked');
    expect(current).toHaveAttribute('aria-current', 'step');
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
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
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

  it('splits what PromptMaster checks from what the user decides, and says which is required (C1)', () => {
    const withDegraded: CriterionResult[] = [
      ...criteria,
      { id: 'd', label: 'At least two comparables named', satisfied: false, blocking: true, manual: true, degraded: true, detail: 'tick when the draft covers it' },
    ];
    render(<ExitCriteriaChecklist criteria={withDegraded} manualIds={new Set(['c'])} onToggleManual={vi.fn()} />);
    const checked = screen.getByRole('region', { name: 'Checked by PromptMaster' });
    const yours = screen.getByRole('region', { name: 'For you to decide' });
    expect(within(checked).getByText('Objective is stated')).toBeInTheDocument();
    expect(within(checked).getByText('At least two comparables')).toBeInTheDocument();
    expect(within(yours).getByText('Says what success looks like')).toBeInTheDocument();
    expect(within(yours).getByText('At least two comparables named')).toBeInTheDocument();
    // The degraded criterion is a box, with the reason on the row.
    expect(within(yours).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(yours).getByText(/can't check this one here/)).toBeInTheDocument();
    expect(within(checked).queryAllByRole('checkbox')).toHaveLength(0);
    // Required / optional on every open row; the header counts them.
    expect(screen.getByText('required')).toBeInTheDocument();
    expect(screen.getAllByText('optional')).toHaveLength(2);
    // Everything PromptMaster checks is met; what is open is the user's own.
    expect(screen.getByText(/2 required, 2 optional\. PromptMaster has verified what it can; this stage is waiting for your approval\./)).toBeInTheDocument();
  });

  it('shows the boxes but does not let them be ticked while only viewing (A3)', async () => {
    const onToggle = vi.fn();
    render(<ExitCriteriaChecklist criteria={criteria} manualIds={new Set(['c'])} onToggleManual={onToggle} readOnly />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    expect(screen.getByText(/viewing only/)).toBeInTheDocument();
    await userEvent.click(box);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('left-open stages are named where finishing happens (A3, Sean 28 Sep item 20)', () => {
  const positioning = BOOK_V1.stages.find((s) => s.id === 'positioning')!;
  const summary = {
    deliverable: BOOK_V1.stages.find((s) => s.id === 'drafting'),
    deliverableDone: true,
    completed: 12,
    withArtifact: 12,
    skipped: 0,
    leftOpen: 1,
    leftOpenStages: [positioning],
    blocked: 0,
    notStarted: 0,
  };

  it('the Finish dialog names the stage and offers to go and close it', async () => {
    const onViewStage = vi.fn();
    render(
      <CompletionDialog summary={summary} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} onViewStage={onViewStage} />
    );
    expect(screen.getByText(/Left open, requirements still unticked: Positioning/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close Positioning' }));
    expect(onViewStage).toHaveBeenCalledWith('positioning');
    // The confirm buttons keep their names: nothing else changes for the user.
    expect(screen.getByRole('button', { name: /^Finish/ })).toBeInTheDocument();
  });

  it('the finished banner still lists what was left open, and links to it', async () => {
    const onViewStage = vi.fn();
    render(
      <ProjectFinishedBanner
        onReopen={vi.fn()}
        leftOpen={[{ id: 'positioning', label: 'Positioning' }]}
        onViewStage={onViewStage}
      />
    );
    expect(screen.getByText('This project is finished')).toBeInTheDocument();
    expect(screen.getByText(/Left open: Positioning/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close Positioning' }));
    expect(onViewStage).toHaveBeenCalledWith('positioning');
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
    const advance = screen.getByRole('button', { name: 'Override and advance' });
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
    await userEvent.click(screen.getByRole('button', { name: 'Override and advance' }));

    expect(onTransition).not.toHaveBeenCalled();
    // A required item is open: this is an override, and it needs its reason.
    expect(screen.getByText(/You are overriding something this stage requires/)).toBeInTheDocument();
    expect(screen.getByText(/Objective is stated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Override and continue' })).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason for the override' }), 'Drafting the objective later');
    await userEvent.click(screen.getByRole('button', { name: 'Override and continue' }));
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

describe('StageTransitionBar with one primary action (PM-06)', () => {
  const stage = BOOK_V1.stages[1]; // Audience: can skip, can go back
  const evaluation = evaluateStage(BOOK_V1, stage.id, ctx({ itemCounts: { audience: 2 } }));
  const options = availableTransitions(BOOK_V1, { current_stage_id: stage.id, stages: {} }, evaluation);

  it('shows a single primary and puts moving on, skipping and going back under More', async () => {
    const onPrimary = vi.fn();
    const onTransition = vi.fn();
    render(
      <StageTransitionBar
        stage={stage}
        evaluation={evaluation}
        options={options}
        onTransition={onTransition}
        primary={{ kind: 'evaluate', label: 'Check this stage', reason: 'One model call.' }}
        onPrimary={onPrimary}
        more={[{ id: 'regenerate', label: 'Regenerate this stage', icon: 'refresh', onSelect: vi.fn() }]}
        nextStageLabel="Positioning"
      />
    );
    const bar = screen.getByRole('group', { name: 'Stage actions' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Moreexpand_more', 'Check this stage']);

    await userEvent.click(within(bar).getByRole('button', { name: 'Check this stage' }));
    expect(onPrimary).toHaveBeenCalled();

    await userEvent.click(within(bar).getByRole('button', { name: /More/ }));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items.some((t) => t?.includes('Regenerate this stage'))).toBe(true);
    expect(items.some((t) => t?.includes('Continue to Positioning'))).toBe(true);
    expect(items.some((t) => t?.includes('Skip this stage'))).toBe(true);
  });

  it('runs the transition itself when moving on is the primary', async () => {
    const onTransition = vi.fn();
    render(
      <StageTransitionBar
        stage={stage}
        evaluation={evaluation}
        options={options}
        onTransition={onTransition}
        primary={{ kind: 'continue', label: 'Continue to Positioning', reason: '' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue to Positioning' }));
    expect(onTransition).toHaveBeenCalledWith(expect.objectContaining({ kind: 'advance' }));
  });
});

describe('the finished screen puts the work at the centre (C4, Sean 28 Sep item 15)', () => {
  const template = SINGLE_OUTPUT_V1;
  const stage = deliverableStage(template)!;
  const project = { id: 'p1', title: 'Field guide', workflow: 'single_output', status: 'finalized' } as never;
  const summary = {
    deliverable: stage, deliverableDone: true, completed: 5, withArtifact: 5, skipped: 0, leftOpen: 0, leftOpenStages: [], blocked: 0, notStarted: 0,
  };
  const bundle = (content: string) => ({
    project, template, state: initialState(template), events: [], evaluations: {},
    stages: { [stage.id]: { artifact: null, versions: [researchVersion(content)] } },
  });

  it('says it is complete, counts the words, and reads the work on request', async () => {
    render(<ProjectFinished bundle={bundle('One two three four five.')} completion={summary} onReopen={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Your work is complete' })).toBeInTheDocument();
    expect(screen.getByText(/5 words · 5 stages done/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Word' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export PDF' })).toHaveAttribute('href', '/projects/p1/print');
    await userEvent.click(screen.getByRole('button', { name: 'Read the full work' }));
    expect(screen.getByText('One two three four five.')).toBeInTheDocument();
  });

  it('a research project is a research report in sections, not a book in chapters (1 Oct, item 26)', () => {
    const drafting = deliverableStage(RESEARCH_V1)!;
    const outline = ['Question', 'Results'].map((title, i) => ({
      id: `s${i}`, title, abstract: '', status: 'complete', content: `Body of ${title}.`, revision: 1, finish_reason: null, error: null, generated_at: null,
    }));
    render(
      <ProjectFinished
        bundle={{
          project: { id: 'p2', title: 'Churn', workflow: 'research', status: 'finalized' } as never,
          template: RESEARCH_V1, state: initialState(RESEARCH_V1), events: [], evaluations: {},
          stages: { [drafting.id]: { artifact: { id: 'a', stage_id: drafting.id, long_form: { outline } } as never, versions: [] } },
        }}
        completion={{ ...summary, deliverable: drafting }}
        onReopen={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Your research report is complete' })).toBeInTheDocument();
    expect(screen.getByText(/^2 sections · /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read the full research report' })).toBeInTheDocument();
    expect(screen.queryByText(/book|chapter/i)).not.toBeInTheDocument();
  });

  it('offers to edit the work, which reopens the project at the stage that holds it', async () => {
    const onEdit = vi.fn();
    render(<ProjectFinished bundle={bundle('One two three.')} completion={summary} onReopen={vi.fn()} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit the work' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('offers to start a new version, and says so when the finished one could not be kept', async () => {
    const onNewVersion = vi.fn().mockRejectedValueOnce(new Error('The finished work could not be kept as a version, so nothing was reopened.')).mockResolvedValue(undefined);
    render(<ProjectFinished bundle={bundle('One two three.')} completion={summary} onReopen={vi.fn()} onNewVersion={onNewVersion} />);
    expect(screen.getByText(/keeps this work in the version history/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a new version' }));
    expect(await screen.findByText(/could not be kept as a version/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a new version' }));
    expect(onNewVersion).toHaveBeenCalledTimes(2);
  });

  it('with nothing written, offers only to continue', () => {
    const onReopen = vi.fn();
    render(<ProjectFinished bundle={bundle('')} completion={summary} onReopen={onReopen} />);
    expect(screen.getByRole('heading', { name: 'This project is finished' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export Word' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Continue improving' }).click();
    expect(onReopen).toHaveBeenCalled();
  });
});
