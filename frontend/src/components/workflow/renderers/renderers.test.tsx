import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StageRenderer } from './stage-renderer';
import { ProseRenderer } from './prose-renderer';
import { ListRenderer } from './list-renderer';
import { ReviewRenderer } from './review-renderer';
import type { StageRendererProps } from './types';
import { BOOK_V1, RESEARCH_V1, evaluateStage, getStage } from '@/lib/workflow';
import {
  isTriaged,
  itemSchemaFor,
  parseItems,
  serializeItems,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import type { StageContext, StageDefinition } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

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

function props(stage: StageDefinition, overrides: Partial<StageRendererProps> = {}) {
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
  } satisfies StageRendererProps;
}

const bookStage = (id: string) => getStage(BOOK_V1, id)!;

// ---------------------------------------------------------------------------
// The rule that matters most: no renderer may branch on which workflow it is.
// ---------------------------------------------------------------------------

describe('renderers are workflow-agnostic', () => {
  it('the same list renderer draws Book audience segments and Research items', () => {
    const book = bookStage('audience');
    const { unmount } = render(
      <ListRenderer
        {...props(book, {
          versions: [version(serializeItems([{ id: 'i1', who: 'Engineering leads' }]))],
        })}
      />
    );
    expect(screen.getByLabelText('Who they are')).toHaveValue('Engineering leads');
    unmount();

    // A Research list stage, same component, different fields — chosen from the
    // schema, not from a branch.
    const research = RESEARCH_V1.stages.find((s) => s.renderer === 'list')!;
    render(<ListRenderer {...props(research, { versions: [version(serializeItems([]))] })} />);
    expect(screen.getByRole('button', { name: /Add another/ })).toBeInTheDocument();
  });

  it('one component renders two different item shapes', () => {
    // The whole schema-driven claim in one test: {who, prior_knowledge,
    // what_they_want} and {statement, prediction, disconfirming_observation}
    // are the same component with different data.
    const audience = bookStage('audience');
    const { unmount } = render(<ListRenderer {...props(audience, { versions: [version(serializeItems([{ id: 'i1' }]))] })} />);
    expect(screen.getByLabelText('What they already know')).toBeInTheDocument();
    expect(screen.queryByLabelText('What it predicts')).not.toBeInTheDocument();
    unmount();

    const hypothesis: StageDefinition = {
      ...audience,
      id: 'hypothesis',
      label: 'Hypothesis',
      expected_artifacts: [{ kind: 'hypothesis', cardinality: 'many', primary: true }],
    };
    render(<ListRenderer {...props(hypothesis, { versions: [version(serializeItems([{ id: 'i1' }]))] })} />);
    expect(screen.getByLabelText('What it predicts')).toBeInTheDocument();
    expect(screen.queryByLabelText('What they already know')).not.toBeInTheDocument();
  });

  it('dispatches on the renderer, not on the workflow', () => {
    const { unmount } = render(<StageRenderer {...props(bookStage('objective'))} />);
    // Prose stages offer a markdown editor; list stages do not.
    expect(screen.getByRole('button', { name: /Draft the objective/i })).toBeInTheDocument();
    unmount();

    render(<StageRenderer {...props(bookStage('audience'))} />);
    expect(screen.getByRole('button', { name: /Add another audience segment/ })).toBeInTheDocument();
  });

  it('names the renderers that are not built yet rather than falling through', () => {
    // The outline editor is the one that remains. Falling through to prose here
    // would render an outline as a wall of text and look like a bug, not a gap.
    render(<StageRenderer {...props(bookStage('outline'))} />);
    expect(screen.getByText(/not built yet/)).toBeInTheDocument();
  });

  it('renders drafting through the long-form renderer, not the placeholder', () => {
    render(<StageRenderer {...props(bookStage('drafting'))} />);
    expect(screen.queryByText(/not built yet/)).not.toBeInTheDocument();
  });

  it('says drafting is unwired rather than crashing when no project context is passed', () => {
    // The renderer enqueues server jobs, so it needs a project. Missing context
    // is a wiring mistake and must read as one.
    render(<StageRenderer {...props(bookStage('drafting'))} />);
    expect(screen.getByText(/not wired to a project/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Exit criteria: the test that could not pass before this stream.
// ---------------------------------------------------------------------------

/** The derivation the workspace does, extracted so it can be asserted directly. */
function contextFrom(
  template: typeof BOOK_V1,
  contents: Record<string, string>
): StageContext {
  const itemCounts: Record<string, number> = {};
  const itemsMissingStatus: Record<string, number> = {};
  const artifactNonEmpty: Record<string, boolean> = {};

  for (const stage of template.stages) {
    const content = contents[stage.id] ?? '';
    artifactNonEmpty[stage.id] = content.trim().length > 0;
    const items = parseItems(content);
    if (!items) continue;
    const schema = itemSchemaFor(stage);
    itemCounts[stage.id] = items.length;
    itemsMissingStatus[stage.id] = items.filter((i) => !isTriaged(i, schema)).length;
  }

  return {
    fields: {},
    itemCounts,
    itemsMissingStatus,
    artifactNonEmpty,
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 0,
    findingsTriaged: 0,
    manualChecks: {},
  };
}

describe('exit criteria are satisfiable', () => {
  it('min_items flips from unsatisfied to satisfied as items are added', () => {
    // This is the regression the stream exists to fix: itemCounts was hardcoded
    // to {}, so every min_items criterion in both templates evaluated false and
    // no user could ever satisfy one.
    const empty = evaluateStage(BOOK_V1, 'audience', contextFrom(BOOK_V1, {}));
    const min = empty.criteria.find((c) => c.id === 'aud.one')!;
    expect(min.satisfied).toBe(false);
    expect(min.detail).toBe('0 of 1');

    const filled = evaluateStage(
      BOOK_V1,
      'audience',
      contextFrom(BOOK_V1, {
        audience: serializeItems([{ id: 'i1', who: 'Engineering leads' }]),
      })
    );
    expect(filled.criteria.find((c) => c.id === 'aud.one')!.satisfied).toBe(true);
  });

  it('every_item_has_status counts a row without its required reason as unresolved', () => {
    const schema = itemSchemaFor(bookStage('fact_check'));
    const removedWithoutReason: StageItem = { id: 'i1', claim: 'x', status: 'removed' };
    const verified: StageItem = { id: 'i2', claim: 'y', status: 'verified' };

    const partial = evaluateStage(
      BOOK_V1,
      'fact_check',
      contextFrom(BOOK_V1, { fact_check: serializeItems([removedWithoutReason, verified]) })
    );
    const criterion = partial.criteria.find((c) => c.id === 'fc.status')!;
    expect(criterion.satisfied).toBe(false);
    expect(criterion.detail).toBe('1 still unresolved');

    // "Removed" on its own is a shrug; "removed because" is a decision.
    expect(isTriaged({ ...removedWithoutReason, reason: 'Could not source it.' }, schema)).toBe(true);

    const done = evaluateStage(
      BOOK_V1,
      'fact_check',
      contextFrom(BOOK_V1, {
        fact_check: serializeItems([
          { ...removedWithoutReason, reason: 'Could not source it.' },
          verified,
        ]),
      })
    );
    expect(done.criteria.find((c) => c.id === 'fc.status')!.satisfied).toBe(true);
  });

  it('the same derivation satisfies a Research stage', () => {
    const listStage = RESEARCH_V1.stages.find(
      (s) => s.renderer === 'list' && s.exit_criteria.some((c) => c.rule?.type === 'min_items')
    )!;
    const rule = listStage.exit_criteria.find((c) => c.rule?.type === 'min_items')!;
    const n = (rule.rule as { type: 'min_items'; n: number }).n;

    const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: 'x' }));
    const evaluated = evaluateStage(
      RESEARCH_V1,
      listStage.id,
      contextFrom(RESEARCH_V1 as typeof BOOK_V1, { [listStage.id]: serializeItems(items) })
    );
    expect(evaluated.criteria.find((c) => c.id === rule.id)!.satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

describe('ProseRenderer', () => {
  it('edits and saves as a new version rather than overwriting', async () => {
    const user = userEvent.setup();
    const onSaveContent = vi.fn(async () => {});
    render(
      <ProseRenderer
        {...props(bookStage('objective'), {
          versions: [version('Original text.')],
          onSaveContent,
        })}
      />
    );

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    const box = screen.getByLabelText(/Edit Objective/);
    await user.clear(box);
    await user.type(box, 'Rewritten.');
    await user.click(screen.getByRole('button', { name: /Save as new version/ }));

    expect(onSaveContent).toHaveBeenCalledWith('Rewritten.');
  });

  it('will not save when nothing changed', async () => {
    const user = userEvent.setup();
    render(<ProseRenderer {...props(bookStage('objective'), { versions: [version('Text.')] })} />);
    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByRole('button', { name: /Save as new version/ })).toBeDisabled();
  });

  it('confirms before regenerating over existing work', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(
      <ProseRenderer
        {...props(bookStage('objective'), { versions: [version('Existing.')], onGenerate })}
      />
    );

    await user.click(screen.getByRole('button', { name: /Regenerate/ }));
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/stays in the history/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Regenerate' })[0]);
    expect(onGenerate).toHaveBeenCalledWith({ force: true });
  });

  it('generates without asking when the stage is empty', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<ProseRenderer {...props(bookStage('objective'), { onGenerate })} />);
    await user.click(screen.getByRole('button', { name: /Draft the objective/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('offers no editing while browsing an earlier stage', () => {
    render(
      <ProseRenderer
        {...props(bookStage('objective'), { versions: [version('Text.')], readOnly: true })}
      />
    );
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument();
  });

  it('shows drafting state and lets it be stopped', async () => {
    const user = userEvent.setup();
    const onCancelGeneration = vi.fn();
    render(<ProseRenderer {...props(bookStage('objective'), { generating: true, onCancelGeneration })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Drafting/);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onCancelGeneration).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('ListRenderer', () => {
  it('adds an item and saves the whole array', async () => {
    const user = userEvent.setup();
    const onSaveItems = vi.fn(async (items: StageItem[]) => { void items; });
    render(
      <ListRenderer
        {...props(bookStage('audience'), { versions: [version(serializeItems([]))], onSaveItems })}
      />
    );

    await user.click(screen.getByRole('button', { name: /Add another audience segment/ }));
    await user.type(screen.getByLabelText('Who they are'), 'Engineering leads');
    await user.click(screen.getByRole('button', { name: /Save as new version/ }));

    expect(onSaveItems).toHaveBeenCalledTimes(1);
    const saved = onSaveItems.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].who).toBe('Engineering leads');
  });

  it('drops blank rows on save rather than blocking while typing', async () => {
    const user = userEvent.setup();
    const onSaveItems = vi.fn(async (items: StageItem[]) => { void items; });
    render(
      <ListRenderer
        {...props(bookStage('audience'), {
          versions: [version(serializeItems([{ id: 'i1', who: 'Leads' }]))],
          onSaveItems,
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /Add another audience segment/ }));
    await user.click(screen.getByRole('button', { name: /Save as new version/ }));

    const saved = onSaveItems.mock.calls[0][0];
    expect(saved).toHaveLength(1);
  });

  it('asks before deleting a row', async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer
        {...props(bookStage('audience'), {
          versions: [version(serializeItems([{ id: 'i1', who: 'Leads' }]))],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /Delete audience segment 1/ }));
    expect(screen.getByText(/Delete this audience segment\?/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByLabelText('Who they are')).toHaveValue('Leads');
  });

  it('reorders with buttons, so 30 rows are usable without dragging', async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer
        {...props(bookStage('audience'), {
          versions: [
            version(
              serializeItems([
                { id: 'i1', who: 'First' },
                { id: 'i2', who: 'Second' },
              ])
            ),
          ],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /Move audience segment 2 up/ }));
    expect(screen.getAllByLabelText('Who they are')[0]).toHaveValue('Second');
  });

  it('says how many the stage still expects', () => {
    render(<ListRenderer {...props(bookStage('audience'), { versions: [version(serializeItems([]))] })} />);
    expect(screen.getByText(/2 expected/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

describe('ReviewRenderer', () => {
  const rows = serializeItems([
    { id: 'i1', claim: 'The sky is blue', source: 'Everyone' },
    { id: 'i2', claim: 'Nine in ten agree', source: 'Unclear' },
  ]);

  it('renders a real table with the schema’s columns', () => {
    render(<ReviewRenderer {...props(bookStage('fact_check'), { versions: [version(rows)] })} />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Claim' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(within(table).getByText('The sky is blue')).toBeInTheDocument();
  });

  it('demands a reason for a status that dismisses, and not for one that accepts', async () => {
    const user = userEvent.setup();
    render(<ReviewRenderer {...props(bookStage('fact_check'), { versions: [version(rows)] })} />);

    // Verified is a decision that stands on its own.
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Verified' }));
    expect(screen.queryByText(/still counts as unresolved/)).not.toBeInTheDocument();

    // Unverifiable is legitimate, but has to say why.
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Unverifiable' }));
    expect(screen.getByText(/still counts as unresolved/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Why unverifiable\?/), 'No primary source.');
    expect(screen.queryByText(/still counts as unresolved/)).not.toBeInTheDocument();
  });

  it('reports what is still outstanding', () => {
    render(<ReviewRenderer {...props(bookStage('fact_check'), { versions: [version(rows)] })} />);
    expect(screen.getByText('2 still to resolve')).toBeInTheDocument();
  });

  it('is read-only while browsing an earlier stage', () => {
    render(
      <ReviewRenderer
        {...props(bookStage('fact_check'), { versions: [version(rows)], readOnly: true })}
      />
    );
    expect(screen.queryByRole('button', { name: /Not looked at/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Not looked at').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Version history is shared furniture
// ---------------------------------------------------------------------------

describe('version history', () => {
  it.each([
    ['prose', ProseRenderer, bookStage('objective'), 'Some prose.'],
    ['list', ListRenderer, bookStage('audience'), serializeItems([{ id: 'i1', who: 'Leads' }])],
    ['review', ReviewRenderer, bookStage('fact_check'), serializeItems([{ id: 'i1', claim: 'x' }])],
  ] as const)('%s offers Restore only while looking at an older version', async (_name, Renderer, stage, content) => {
    const user = userEvent.setup();
    const onRestore = vi.fn(async () => {});
    const versions = [version(content, 1), version(content, 2)];

    const { rerender } = render(
      <Renderer {...props(stage, { versions, activeVersionId: 'v2', onRestore })} />
    );
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();

    rerender(<Renderer {...props(stage, { versions, activeVersionId: 'v1', onRestore })} />);
    await user.click(screen.getByRole('button', { name: 'Restore v1' }));
    expect(onRestore).toHaveBeenCalledWith('v1');
  });
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

describe('stage items serialise into the version content column', () => {
  it('round-trips', () => {
    const items: StageItem[] = [{ id: 'i1', who: 'Leads', prior_knowledge: 'Some' }];
    expect(parseItems(serializeItems(items))).toEqual(items);
  });

  it('returns null for prose so a list stage can tell empty from not-a-list', () => {
    expect(parseItems('# A heading\n\nSome prose.')).toBeNull();
    expect(parseItems('')).toBeNull();
    expect(parseItems('{ not json')).toBeNull();
  });

  it('drops malformed rows rather than throwing inside a renderer', () => {
    const parsed = parseItems('{"kind":"stage_items","items":[{"who":"a"},null,"x",7]}');
    expect(parsed).toHaveLength(1);
    expect(parsed![0].id).toBeTruthy();
  });
});
