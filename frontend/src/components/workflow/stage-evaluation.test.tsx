/**
 * The stage-evaluation UI: the control, and what it shows afterwards.
 *
 * The FR-11 and FR-12 assertions about *what reaches the model* live in the
 * backend suite, against the pure prompt builder. What is testable here is the
 * half the user touches: that evaluating is a deliberate act with a visible
 * cost, that it never fires on its own, and that the findings the evaluation
 * persisted are actually readable afterwards.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StageEvaluationPanel } from './evaluation-panel';
import { ProseRenderer } from './renderers/prose-renderer';
import { ListRenderer } from './renderers/list-renderer';
import { ReviewRenderer } from './renderers/review-renderer';
import type { StageRendererProps } from './renderers/types';
import { BOOK_V1, getStage } from '@/lib/workflow';
import { itemSchemaFor, serializeItems } from '@/lib/workflow/stage-artifact';
import type { StageDefinition } from '@/lib/workflow/types';
import type { ArtifactVersion, Evaluation } from '@/types/project';
import type { AuditFinding, StageRecommendation } from '@/types';

function version(content: string, n = 1): ArtifactVersion {
  return {
    id: `v${n}`,
    user_id: 'u1',
    project_id: 'p1',
    artifact_id: 'a1',
    version_number: n,
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

function props(
  stage: StageDefinition,
  overrides: Partial<StageRendererProps> = {}
): StageRendererProps {
  return {
    stage,
    schema: itemSchemaFor(stage),
    versions: [],
    activeVersionId: null,
    onSelectVersion: vi.fn(),
    onRestore: vi.fn(async () => {}),
    onSaveContent: vi.fn(async () => {}),
    onSaveItems: vi.fn(async () => {}),
    generating: false,
    generationError: null,
    onGenerate: vi.fn(),
    onCancelGeneration: vi.fn(),
    readOnly: false,
    ...overrides,
  };
}

const FINDINGS: AuditFinding[] = [
  {
    id: 'f1',
    category: 'approved outline',
    summary: 'Promises chapters the approved outline does not contain.',
    suggested_change: 'Align the chapter list with the three approved sections.',
  },
  {
    id: 'f2',
    category: 'constraints',
    summary: 'Names two vendors, which the constraints forbid.',
    suggested_change: 'Remove the vendor names.',
  },
];

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    user_id: 'u1',
    project_id: 'p1',
    version_id: 'v1',
    alignment_score: 'Low',
    alignment_explanation: 'It does not position the book.',
    drift_score: 'High',
    drift_explanation: 'Drifts on the outline and the constraints.',
    clarity_score: 'Medium',
    clarity_explanation: 'Readable but shapeless.',
    completeness_status: 'incomplete',
    completeness_reason: 'No comparable books are named.',
    interpretation: { label: 'What to improve', bullets: ['Off the objective.', 'No structure.'] },
    findings: FINDINGS,
    needs_realignment: true,
    evaluator_model: 'test/model',
    source: 'manual',
    created_at: '2026-09-04T00:00:00Z',
    ...overrides,
  };
}

const RECOMMENDATION: StageRecommendation = {
  id: 'r1',
  title: 'Rewrite the positioning against the approved outline',
  triggering_issue: 'Alignment Low and drift High across three axes.',
  expected_benefit: 'A positioning statement the drafting stages can be judged against.',
  scope: 'The positioning stage only.',
  instruction: 'Rewrite naming two comparable books, no vendors, for managers.',
};

// --- the control ------------------------------------------------------------

describe('the Evaluate control', () => {
  const objective = getStage(BOOK_V1, 'objective')!;

  it('states its cost, because the whole point is that the user chooses it', () => {
    render(
      <ProseRenderer
        {...props(objective, { versions: [version('An objective.')], onEvaluate: vi.fn() })}
      />
    );

    const button = screen.getByRole('button', { name: /evaluate this stage/i });
    expect(button.textContent).toMatch(/1 model call/);
  });

  it('fires only when pressed — nothing evaluates on render', async () => {
    const onEvaluate = vi.fn();
    render(
      <ProseRenderer {...props(objective, { versions: [version('An objective.')], onEvaluate })} />
    );

    expect(onEvaluate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /evaluate this stage/i }));
    expect(onEvaluate).toHaveBeenCalledTimes(1);
  });

  it('is absent on an empty stage — there is nothing to judge yet', () => {
    render(<ProseRenderer {...props(objective, { versions: [], onEvaluate: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: /evaluate this stage/i })).toBeNull();
  });

  it('is absent while browsing an earlier stage', () => {
    render(
      <ProseRenderer
        {...props(objective, {
          versions: [version('An objective.')],
          onEvaluate: vi.fn(),
          readOnly: true,
        })}
      />
    );
    expect(screen.queryByRole('button', { name: /evaluate this stage/i })).toBeNull();
  });

  it('is absent when no writer was supplied, rather than broken', () => {
    render(<ProseRenderer {...props(objective, { versions: [version('An objective.')] })} />);
    expect(screen.queryByRole('button', { name: /evaluate this stage/i })).toBeNull();
  });

  it('disables itself and says so while a call is in flight', () => {
    render(
      <ProseRenderer
        {...props(objective, {
          versions: [version('An objective.')],
          onEvaluate: vi.fn(),
          evaluating: true,
        })}
      />
    );
    const button = screen.getByRole('button', { name: /evaluating/i });
    expect(button).toBeDisabled();
  });

  it('surfaces a failed evaluation without taking the stage down', () => {
    render(
      <ProseRenderer
        {...props(objective, {
          versions: [version('An objective.')],
          onEvaluate: vi.fn(),
          evaluationError: 'Could not evaluate this stage. Try again in a moment.',
        })}
      />
    );
    expect(screen.getByRole('alert').textContent).toMatch(/could not evaluate/i);
    // Still offered again — a failure is recoverable by pressing the button.
    expect(screen.getByRole('button', { name: /evaluate this stage/i })).toBeEnabled();
  });

  it('reaches list and review stages too, on the same props', () => {
    const audience = getStage(BOOK_V1, 'audience')!;
    const items = serializeItems([{ id: 'i1', who: 'Managers' }]);
    const { unmount } = render(
      <ListRenderer {...props(audience, { versions: [version(items)], onEvaluate: vi.fn() })} />
    );
    expect(screen.getByRole('button', { name: /evaluate this stage/i })).toBeTruthy();
    unmount();

    const factCheck = getStage(BOOK_V1, 'fact_check')!;
    render(
      <ReviewRenderer
        {...props(factCheck, {
          versions: [version(serializeItems([{ id: 'i1', claim: 'A claim' }]))],
          onEvaluate: vi.fn(),
        })}
      />
    );
    expect(screen.getByRole('button', { name: /evaluate this stage/i })).toBeTruthy();
  });
});

// --- the panel --------------------------------------------------------------

describe('the evaluation panel', () => {
  it('shows the findings, which is the whole of what M4.1 newly persists', () => {
    render(
      <StageEvaluationPanel
        evaluation={evaluation()}
      />
    );

    expect(screen.getByText(/2 findings/i)).toBeTruthy();
    expect(screen.getByText(/approved outline does not contain/i)).toBeTruthy();
    expect(screen.getByText(/Remove the vendor names/i)).toBeTruthy();
    // Categories are the FR-12 axes, and are what make a finding legible.
    expect(screen.getByText('approved outline')).toBeTruthy();
    expect(screen.getByText('constraints')).toBeTruthy();
  });

  it('shows the scores with drift kept at its own polarity', () => {
    render(
      <StageEvaluationPanel
        evaluation={evaluation()}
      />
    );
    const panel = screen.getByLabelText('Stage evaluation');
    expect(panel.textContent).toMatch(/Alignment Low/);
    expect(panel.textContent).toMatch(/Drift High/);
    expect(panel.textContent).toMatch(/needs realignment/);
  });

  it('says so when a clean artifact produced no findings', () => {
    render(
      <StageEvaluationPanel
        evaluation={evaluation({
          findings: [],
          needs_realignment: false,
          completeness_status: 'complete',
          completeness_reason: '',
        })}
      />
    );
    expect(screen.getByText(/no specific defects found/i)).toBeTruthy();
  });

  it('tolerates a row written before findings were ever produced', () => {
    // Every evaluation row written before M4.1 has `findings: []`, and several
    // imported ones predate the column having a producer at all.
    render(
      <StageEvaluationPanel
        evaluation={evaluation({ findings: undefined as unknown as AuditFinding[] })}
      />
    );
    expect(screen.getByText(/no specific defects found/i)).toBeTruthy();
  });

  it('no longer carries the recommendation — M4.2 took it', () => {
    // This panel's docstring used to promise that M4.2 would own accept /
    // modify / reject / apply and the `recommendations` table. It does, so the
    // correction and its "Carry on without it" button have moved to
    // RecommendationsPanel, where the recommendation is a durable row rather
    // than React state that vanished on reload. What is left here is the
    // evidence the recommendation rests on.
    render(<StageEvaluationPanel evaluation={evaluation()} />);

    const panel = screen.getByLabelText('Stage evaluation');
    expect(panel.textContent).not.toContain(RECOMMENDATION.title);
    expect(screen.queryByRole('button', { name: /carry on without it/i })).toBeNull();

    // The findings and scores did not move.
    expect(screen.getByText(/2 findings/i)).toBeTruthy();
    expect(panel.textContent).toMatch(/Alignment Low/);
  });

  it('renders nothing at all before anything has been evaluated', () => {
    const { container } = render(
      <StageEvaluationPanel
        evaluation={undefined}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
