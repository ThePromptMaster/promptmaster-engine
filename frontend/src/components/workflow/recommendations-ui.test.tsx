/**
 * The recommendations surface, as a user meets it — FR-13, FR-14, FR-09, FR-15.
 *
 * The assertions about *what reaches the model* live in the backend suite,
 * against the pure prompt builder. What is testable here is the half the user
 * touches, and two of these are acceptance criteria in their own right:
 *
 * - **FR-09** says the affected scope is shown *before* application. So the
 *   test opens the dialog and asserts the api mock has **not** been called —
 *   "before" is a claim about ordering, and the only way to fail it honestly
 *   is to spend a call on open.
 * - **FR-15** says the combined instruction is visible. So the test asserts
 *   the `<pre>` text is byte-identical to what the request payload's findings
 *   render to, rather than that it merely mentions the same words.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecommendationsPanel, type PanelRecommendation } from './recommendations-panel';
import { ApplyPreview } from './apply-preview';
import { TasksPanel } from './tasks-panel';
import { asFinding } from '@/lib/workflow/combine';
import type { ProjectTask } from '@/lib/supabase/tasks';

// The api module the apply path would call. Mocked at module scope so the
// "has not been called" assertion is about the real seam, not a prop.
const applyRecommendations = vi.fn(async () => ({
  content: 'Revised.',
  instruction: '',
  finish_reason: 'stop',
}));
vi.mock('@/lib/api/client', () => ({
  api: {
    applyRecommendations: (...args: unknown[]) => applyRecommendations(...(args as [])),
  },
  ApiError: class ApiError extends Error {},
}));

function rec(overrides: Partial<PanelRecommendation> = {}): PanelRecommendation {
  return {
    category: 'evaluation:positioning:r1',
    origin: 'evaluation',
    kind: 'realignment',
    title: 'Rewrite the positioning against the approved outline',
    summary: 'Alignment Low and drift High across three of the five axes.',
    suggested_change: 'Rewrite naming two comparable practitioner books.',
    instruction: 'Rewrite naming two comparable practitioner books, no vendors, for managers.',
    rationale: {
      triggering_issue: 'Drift scored High against Positioning.',
      relevant_stage: 'Positioning',
      expected_benefit: 'A positioning statement the drafting stages can be judged against.',
      scope: 'The positioning stage only.',
    },
    scope: { kind: 'document', described_as: 'The positioning stage only.' },
    tags: ['scope:narrow'],
    severity: 'major',
    ...overrides,
  };
}

const SECOND = rec({
  category: 'evaluation:positioning:r2',
  title: 'Cut the survey material',
  summary: 'The stage answers a different question.',
  instruction: 'Remove the literature survey; keep only what positions the book.',
  tags: ['length:shorter'],
  severity: 'minor',
});

const DERIVED: PanelRecommendation = {
  category: 'workflow:positioning:pos.comparables',
  origin: 'derived',
  kind: 'workflow',
  title: 'At least two comparables named',
  summary: '1 of 2 — Positioning is not finished.',
  suggested_change: 'Complete "At least two comparables named" before moving on.',
  // Empty: the affordance is the checklist above.
  instruction: '',
  rationale: {
    triggering_issue: '"At least two comparables named": 1 of 2.',
    relevant_stage: 'Positioning',
    expected_benefit: 'Later stages read this stage’s conclusion.',
    scope: 'Positioning’s artifact.',
  },
  scope: { kind: 'document', described_as: 'Positioning’s artifact.' },
  tags: [],
  severity: 'blocking',
};

type PanelProps = Parameters<typeof RecommendationsPanel>[0];

function panel(overrides: Partial<PanelProps> = {}) {
  const onToggleSelect = vi.fn<PanelProps['onToggleSelect']>();
  const onTriage = vi.fn<PanelProps['onTriage']>();
  const onApply = vi.fn<PanelProps['onApply']>();

  render(
    <RecommendationsPanel
      stageLabel="Positioning"
      rows={[rec(), DERIVED]}
      selected={[]}
      onToggleSelect={onToggleSelect}
      onTriage={onTriage}
      onApply={onApply}
      {...overrides}
    />
  );
  return { onToggleSelect, onTriage, onApply };
}

// --- FR-13 -------------------------------------------------------------------

describe('FR-13: recommendations can be applied or dismissed', () => {
  it('offers Apply only where there is an instruction to apply', () => {
    // The rule is one predicate — `instruction.trim() !== ''` — rather than a
    // list of kinds someone has to remember to extend.
    panel();

    const rows = screen.getAllByRole('listitem');
    const applyable = rows.find((r) => r.textContent?.includes('Rewrite the positioning'))!;
    const derived = rows.find((r) => r.textContent?.includes('At least two comparables'))!;

    expect(within(applyable).getByRole('button', { name: /apply/i })).toBeTruthy();
    expect(within(derived).queryByRole('button', { name: /^apply/i })).toBeNull();
  });

  it('points a workflow recommendation at the affordance that actually closes it', () => {
    // A button here would only record agreement while the gap stayed open.
    panel({ rows: [DERIVED] });
    expect(screen.getByText(/the checklist above tracks it/i)).toBeTruthy();
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(
      <RecommendationsPanel
        stageLabel="Positioning"
        rows={[]}
        selected={[]}
        onToggleSelect={vi.fn()}
        onTriage={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is read-only when the user is browsing an earlier stage', () => {
    panel({ readOnly: true });
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

// --- FR-14 -------------------------------------------------------------------

describe('FR-14: the rationale is readable, all four slots', () => {
  it('shows the triggering issue, stage, benefit and scope', async () => {
    panel({ rows: [rec()] });

    await userEvent.click(screen.getByRole('button', { name: /why this/i }));

    const block = screen.getByTestId('rationale-evaluation:positioning:r1');
    expect(block.textContent).toContain('Drift scored High against Positioning.');
    expect(block.textContent).toContain('Positioning');
    expect(block.textContent).toContain('A positioning statement the drafting stages');
    expect(block.textContent).toContain('The positioning stage only.');
  });

  it('keeps it collapsed until asked — the list is a list, not an essay', () => {
    panel({ rows: [rec()] });
    expect(screen.queryByTestId('rationale-evaluation:positioning:r1')).toBeNull();
  });
});

// --- the triage vocabulary ---------------------------------------------------

describe('statuses that dismiss demand a sentence; statuses that accept do not', () => {
  it('will not record a dismissal until a reason is written', async () => {
    const props = panel({ rows: [rec()] });

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Dismiss' }));

    const confirm = screen.getByRole('button', { name: 'Dismiss' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(props.onTriage).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByLabelText(/why dismiss\?/i),
      'The constraint changed; vendors are allowed now.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(props.onTriage).toHaveBeenCalledTimes(1);
    // The sentence is what lands in decisions.rationale.
    expect(props.onTriage.mock.calls[0][1]).toBe('dismissed');
    expect(props.onTriage.mock.calls[0][2]).toBe(
      'The constraint changed; vendors are allowed now.'
    );
  });

  it('demands one for "Not now" too, and carries it into the task', async () => {
    const props = panel({ rows: [rec()] });

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Not now' }));

    await userEvent.type(
      screen.getByLabelText(/what still needs doing/i),
      'Check what is actually in print first.'
    );
    await userEvent.click(screen.getByRole('button', { name: /add to tasks/i }));

    expect(props.onTriage.mock.calls[0][1]).toBe('deferred');
    expect(props.onTriage.mock.calls[0][2]).toBe('Check what is actually in print first.');
  });

  it('sends an applyable Accept straight to the preview — an accepted fix that changed nothing is not accepted', async () => {
    const props = panel({ rows: [rec()] });

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Accept' }));

    expect(props.onApply).toHaveBeenCalledWith(['evaluation:positioning:r1']);
    expect(props.onTriage).not.toHaveBeenCalled();
  });

  it('offers no Accept on a workflow recommendation', async () => {
    panel({ rows: [DERIVED] });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'Accept' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Dismiss' })).toBeTruthy();
  });
});

// --- FR-15 -------------------------------------------------------------------

describe('FR-15: combining', () => {
  it('offers multi-select only where more than one row can be combined', () => {
    panel({ rows: [rec(), SECOND, DERIVED] });
    // Two applyable rows -> two checkboxes. The derived row gets none: a
    // checkbox beside something uncombinable is a promise that breaks.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('does not offer it for a single applyable row', () => {
    panel({ rows: [rec(), DERIVED] });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('offers Combine once two are selected', async () => {
    const props = panel({
      rows: [rec(), SECOND],
      selected: [rec().category, SECOND.category],
    });
    await userEvent.click(screen.getByRole('button', { name: /combine 2/i }));
    expect(props.onApply).toHaveBeenCalledWith([rec().category, SECOND.category]);
  });
});

// --- FR-09 -------------------------------------------------------------------

type PreviewProps = Parameters<typeof ApplyPreview>[0];

function preview(overrides: Partial<PreviewProps> = {}) {
  const onRemove = vi.fn<PreviewProps['onRemove']>();
  const onApply = vi.fn<PreviewProps['onApply']>();
  const onCancel = vi.fn<PreviewProps['onCancel']>();

  render(
    <ApplyPreview
      selected={[rec()]}
      headVersionNumber={4}
      stageLabel="Positioning"
      applying={false}
      error={null}
      onRemove={onRemove}
      onApply={onApply}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onRemove, onApply, onCancel };
}

describe('FR-09: the scope is shown before application', () => {
  it('renders the scope and has made no model call', () => {
    applyRecommendations.mockClear();
    preview();

    expect(screen.getByTestId('affected-scope').textContent).toContain('The whole document');
    expect(screen.getByRole('dialog')).toBeTruthy();

    // The acceptance criterion is about ordering. Opening the dialog must cost
    // nothing — everything on it is computed from rows already in memory.
    expect(applyRecommendations).not.toHaveBeenCalled();
  });

  it('says what happens to the version that exists', () => {
    preview();
    // Arithmetic, not a promise. It is true because artifact_versions is
    // append-only with a trigger enforcing it.
    expect(screen.getByTestId('version-note').textContent).toBe(
      'v4 stays in history — this appends v5.'
    );
  });

  it('says so honestly when there is no prior version', () => {
    preview({ headVersionNumber: null });
    expect(screen.getByTestId('version-note').textContent).toContain('the first version');
  });

  it('spends nothing until Apply is pressed', async () => {
    const props = preview();
    expect(props.onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });
});

describe('FR-15: the combined instruction is visible, and it is the one that is sent', () => {
  it('renders text byte-identical to the payload’s findings block', () => {
    preview({ selected: [rec(), SECOND] });

    // What the request would carry.
    const payloadFindings = [rec(), SECOND].map(asFinding);
    const payloadBlock = payloadFindings
      .map((f) => `- [${f.category}] ${f.summary} → ${f.suggested_change}`)
      .join('\n');

    // What the user reads. Not "mentions the same words" — the same string.
    expect(screen.getByTestId('combined-instruction').textContent).toBe(payloadBlock);
  });

  it('lists the selected actions and lets them be removed', async () => {
    const props = preview({ selected: [rec(), SECOND] });
    expect(screen.getByText(SECOND.title)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(`remove "${SECOND.title}"`, 'i') })
    );
    expect(props.onRemove).toHaveBeenCalledWith(SECOND.category);
  });

  it('warns about an obvious conflict and leaves Apply enabled', () => {
    // `scope:narrow` against `scope:broaden` on one axis.
    preview({
      selected: [rec({ tags: ['scope:narrow'] }), rec({ ...SECOND, tags: ['scope:broaden'] })],
    });

    expect(screen.getByRole('status').textContent).toMatch(/pull opposite ways on scope/i);
    // Guidance is suggestive, not restrictive — FR-12 says the user may
    // proceed, and the panel says so rather than leaving an enabled button
    // beside a warning to read as a bug.
    const apply = screen.getByRole('button', { name: /combine and apply/i });
    expect(apply.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText(/you can still apply them/i)).toBeTruthy();
  });

  it('shows no warning when nothing conflicts', () => {
    preview({ selected: [rec({ tags: ['scope:narrow'] }), rec({ ...SECOND, tags: ['tone:plain'] })] });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// --- FR-01 -------------------------------------------------------------------

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 't1',
    user_id: 'u',
    project_id: 'p',
    title: 'Name two comparable practitioner books',
    detail: 'Check what is actually in print first.',
    stage: 'positioning',
    status: 'open',
    origin: 'recommendation',
    origin_recommendation_id: null,
    created_at: '2026-09-09T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('FR-01: unresolved tasks are visible', () => {
  it('shows an open task with the sentence the deferral cost', () => {
    render(<TasksPanel tasks={[task()]} onResolve={vi.fn()} />);
    expect(screen.getByText(/name two comparable/i)).toBeTruthy();
    expect(screen.getByText(/check what is actually in print/i)).toBeTruthy();
  });

  it('hides itself when everything is resolved', () => {
    const { container } = render(
      <TasksPanel tasks={[task({ status: 'done' })]} onResolve={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('lets a task be finished or dropped', async () => {
    const onResolve = vi.fn();
    render(<TasksPanel tasks={[task()]} onResolve={onResolve} />);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onResolve).toHaveBeenCalledWith('t1', 'done');

    await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(onResolve).toHaveBeenCalledWith('t1', 'dismissed');
  });
});
