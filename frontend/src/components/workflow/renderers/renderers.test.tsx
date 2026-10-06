import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

    // The real Research stage, not a fabricated one: the registry is keyed by
    // artifact kind, so a test that invents a kind proves nothing about the
    // template that ships. (It also hid a near-miss — the template declares
    // 'hypotheses' and the registry had 'hypothesis', which quietly demoted the
    // stage to a single free-text field.)
    const hypothesis = getStage(RESEARCH_V1, 'hypothesis')!;
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

  it('no renderer source so much as names a workflow', () => {
    // The behavioural tests above prove the renderers behave the same for both
    // workflows today. This one closes the door on the shortcut that would end
    // that: adding Research's derived outline made it tempting to special-case
    // drafting, and the rule is that routing on `outline_stage` happens in the
    // workspace, on a field, never in a renderer, on a name.
    const dir = join(process.cwd(), 'src', 'components', 'workflow', 'renderers');
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
    expect(files.length).toBeGreaterThan(0);

    // What a branch would actually look like, rather than any mention of the
    // word: a workflow key as a literal, a template import, or a reach for the
    // fields only the workspace is allowed to route on. A prose comment saying
    // "research claims" is not a branch.
    const banned: Array<[RegExp, string]> = [
      [/['"`](book|research|single_output)['"`]/, 'a workflow key as a string literal'],
      [/\b(BOOK_V1|RESEARCH_V1|SINGLE_OUTPUT_V1)\b/, 'a template import'],
      [/\b(template|workflow)\s*[.?]\s*(key|outline_stage|derived_outline)\b/, 'the workflow identity'],
    ];

    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const [pattern, what] of banned) {
        expect(source, `${file} branches on ${what}`).not.toMatch(pattern);
      }
    }
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
  const findings: StageContext['findings'] = {};

  for (const stage of template.stages) {
    const content = contents[stage.id] ?? '';
    artifactNonEmpty[stage.id] = content.trim().length > 0;
    const items = parseItems(content);
    if (!items) continue;
    const schema = itemSchemaFor(stage);
    itemCounts[stage.id] = items.length;
    itemsMissingStatus[stage.id] = items.filter((i) => !isTriaged(i, schema)).length;
    if (stage.renderer === 'review') {
      findings[stage.id] = { total: items.length, triaged: items.length - itemsMissingStatus[stage.id] };
    }
  }

  return {
    fields: {},
    itemCounts,
    itemsMissingStatus,
    artifactNonEmpty,
    outlineApproved: false,
    sections: {},
    findings,
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

    // Verified by me is a decision that stands on its own.
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Human verified' }));
    expect(screen.queryByText(/still counts as unresolved/)).not.toBeInTheDocument();

    // Unverifiable is legitimate, but has to say why.
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Unverifiable' }));
    expect(screen.getByText(/still counts as unresolved/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Why unverifiable\?/), 'No primary source.');
    expect(screen.queryByText(/still counts as unresolved/)).not.toBeInTheDocument();
  });

  it('looks the named sources up: a found source is shown with its record, still to be checked, and saved by the user', async () => {
    const user = userEvent.setup();
    const onSaveItems = vi.fn(async () => {});
    const onLookupItems = vi.fn(async (items: StageItem[]) => ({
      items: items.map((i) =>
        i.id === 'i1'
          ? { ...i, status: 'source_found', status_source: 'tool', record: 'Why the Sky Is Blue — Mock, A. (2020)', link: 'https://doi.org/10.0000/mock.1' }
          : i
      ),
      message: '1 of 2 sources found in OpenAlex.',
    }));
    render(<ReviewRenderer {...props(bookStage('fact_check'), { versions: [version(rows)], onLookupItems, onSaveItems })} />);
    // The lookup's own columns are not there until a row holds something in them.
    expect(screen.queryByRole('columnheader', { name: 'Record found' })).not.toBeInTheDocument();
    expect(screen.getByText(/It finds whether the source exists, not whether it says this/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Look up these sources' }));
    expect(await screen.findByText('1 of 2 sources found in OpenAlex.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Record found' })).toBeInTheDocument();
    expect(screen.getByText('Why the Sky Is Blue — Mock, A. (2020)')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Source found by PromptMaster — check it says this');
    // Found is not decided: both rows are still the author's.
    expect(screen.getByText('2 still to resolve')).toBeInTheDocument();
    // "Source found" is a tool's to set: on a row that does not carry it, it is not a choice.
    await user.click(screen.getAllByRole('combobox')[1]);
    expect(screen.queryByRole('option', { name: /Source found by PromptMaster/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Save as new version' }));
    expect(onSaveItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'i1', status: 'source_found', status_source: 'tool' })]));
  });

  it('offers the reason the row already gives, so it is not typed a second time (2 Oct, item 1)', async () => {
    const user = userEvent.setup();
    const stage = getStage(RESEARCH_V1, 'experiment')!;
    const runs = serializeItems([
      { id: 'r1', run: 'Compare churn by cohort', deviation: 'Required source data were not provided, so the planned run could not be executed.' },
      { id: 'r2', run: 'Interview five customers' },
    ]);
    render(<ReviewRenderer {...props(stage, { versions: [version(runs)] })} />);
    expect(screen.getByText('2 still to resolve')).toBeInTheDocument();

    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'Not run' }));
    // Resolved at once: the reason came from the row, and says so.
    expect(screen.getByLabelText(/Why not run\?/)).toHaveValue('Required source data were not provided, so the planned run could not be executed.');
    expect(screen.getByText(/Filled in from what this row already says/)).toBeInTheDocument();
    expect(screen.getByText('1 still to resolve')).toBeInTheDocument();

    // A row that says nothing still asks.
    await user.click(screen.getAllByRole('combobox')[1]);
    await user.click(screen.getByRole('option', { name: 'Not run' }));
    expect(screen.getByText(/still counts as unresolved/)).toBeInTheDocument();

    // Once edited, the reason is the user's own.
    await user.type(screen.getByLabelText(/Why not run\?/, { selector: '#r1-reason' }), ' Confirmed.');
    expect(screen.queryByText(/Filled in from what this row already says/)).not.toBeInTheDocument();
  });

  it('says of a run that could not be made that PromptMaster recorded why', () => {
    const stage = getStage(RESEARCH_V1, 'experiment')!;
    const runs = serializeItems([
      { id: 'r1', run: 'Compare churn by cohort', status: 'not_run', status_source: 'sandbox', reason: 'Could not be run: churn records were not provided.' },
      { id: 'r2', run: 'Count accounts', status: 'completed', status_source: 'sandbox', observed: 'Ran in the sandbox.' },
    ]);
    render(<ReviewRenderer {...props(stage, { versions: [version(runs)] })} />);
    expect(screen.getByText('all resolved')).toBeInTheDocument();
    expect(screen.getByText(/1 could not be run — PromptMaster recorded why/)).toBeInTheDocument();
    expect(screen.getByText(/1 recorded from code that ran in the sandbox/)).toBeInTheDocument();
    expect(screen.getByText('Recorded by PromptMaster: the run could not be made')).toBeInTheDocument();
  });

  it('Validation offers what was actually done, in plain words, and keeps an older "Reproduced" readable (2 Oct, items 12 and 13)', async () => {
    const user = userEvent.setup();
    const stage = getStage(RESEARCH_V1, 'validation')!;
    const table = serializeItems([
      { id: 'v1', result: 'Churn is concentrated in recent cohorts', attempt: 'Compared with earlier-cited studies; not recalculated.' },
      { id: 'v2', result: 'Tickets are 40% higher', status: 'reproduced' },
    ]);
    render(<ReviewRenderer {...props(stage, { versions: [version(table)] })} />);
    expect(screen.getByText(/do you accept it as sufficiently supported to move forward\?/)).toBeInTheDocument();
    // The older row keeps its status, relabelled, and still counts as resolved.
    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('Reproduced — kind not recorded');
    expect(screen.getByText('1 still to resolve')).toBeInTheDocument();

    await user.click(screen.getAllByRole('combobox')[0]);
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(['Independently reproduced', 'Supported by prior evidence', 'Consistency check only', 'Not reproduced', 'Not attempted']);
    await user.click(screen.getByRole('option', { name: 'Supported by prior evidence' }));
    expect(screen.getByText('all resolved')).toBeInTheDocument();

    const legend = screen.getByLabelText('What the statuses mean');
    expect(within(legend).getByText('It agrees with earlier studies or records. Nothing was recalculated.')).toBeInTheDocument();
    expect(within(legend).getByText(/Only you can say this — PromptMaster never sets it\./)).toBeInTheDocument();
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
// Research v1 stranded projects at Experiment (Sean's screenshot, Sep 10)
// ---------------------------------------------------------------------------

describe('Final review: open items are findings, not blockers (3 Oct, item 5)', () => {
  it('says marking is optional, and what Carry forward does', async () => {
    const user = userEvent.setup();
    const items = serializeItems([
      { id: 'f1', item: 'Primary-cause attribution unverified', where: 'No driver-level data' },
      { id: 'f2', item: 'Mix shift unresolved', where: 'No SKU data' },
    ]);
    render(<ReviewRenderer {...props(getStage(RESEARCH_V1, 'final_review')!, { versions: [version(items)] })} />);
    expect(screen.getByText('2 not yet marked — optional, does not block finishing')).toBeInTheDocument();
    expect(screen.queryByText(/still to resolve/)).not.toBeInTheDocument();
    expect(screen.getByText(/Marking them is optional and does not block finishing/)).toBeInTheDocument();
    await user.click(screen.getByText('What the statuses mean'));
    expect(screen.getByText(/listed with the finished work — on the finished page and at the end of the exported document/)).toBeInTheDocument();
  });
});

describe('PromptMaster proposes, the user confirms (3 Oct, Research run)', () => {
  const alternatives = () => serializeItems([
    { id: 'a1', explanation: 'Raw-material inflation', how_addressed: 'Partly addressed, not excluded', status: 'left_open', reason: 'Input prices rose, but not enough to explain the gap.', status_source: 'proposed' },
    { id: 'a2', explanation: 'Measurement artefact', how_addressed: 'Reconciled to the ledger', status: 'ruled_out', reason: 'The ledger and the margin report agree.', status_source: 'proposed' },
    { id: 'a3', explanation: 'Mix shift', how_addressed: '' },
  ]);

  it('shows each proposal with its reason and confirms them in one click', async () => {
    const user = userEvent.setup();
    const onSaveItems = vi.fn(async () => {});
    render(<ReviewRenderer {...props(getStage(RESEARCH_V1, 'alternatives')!, { versions: [version(alternatives())], onSaveItems })} />);
    // Proposals are not decisions yet.
    expect(screen.getByText('3 still to resolve')).toBeInTheDocument();
    expect(screen.getByText(/2 proposed by PromptMaster — confirm or change/)).toBeInTheDocument();
    expect(screen.getAllByText('Proposed by PromptMaster')).toHaveLength(2);
    expect(screen.getByText('The ledger and the margin report agree.')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Left open');

    await user.click(screen.getByRole('button', { name: /Confirm the 2 proposals/ }));
    const saved = (onSaveItems.mock.calls[0] as unknown as [StageItem[]])[0];
    expect(saved.map((r) => r.status_source)).toEqual(['user', 'user', undefined]);
    expect(saved[0].reason).toBe('Input prices rose, but not enough to explain the gap.');
    expect(screen.getByText('1 still to resolve')).toBeInTheDocument();
  });

  it('a row the user changes is theirs, and no longer a proposal', async () => {
    const user = userEvent.setup();
    render(<ReviewRenderer {...props(getStage(RESEARCH_V1, 'alternatives')!, { versions: [version(alternatives())] })} />);
    await user.click(screen.getAllByRole('combobox')[1]);
    await user.click(screen.getByRole('option', { name: 'Addressed' }));
    expect(screen.getAllByText('Proposed by PromptMaster')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Confirm the proposal$/ })).toBeInTheDocument();
    expect(screen.getByText('2 still to resolve')).toBeInTheDocument();
  });
});

describe('a long check table folds what is already decided (3 Oct call)', () => {
  const findings = serializeItems(
    Array.from({ length: 9 }, (_, i) => ({
      id: `f${i}`,
      finding: `Finding ${i}`,
      where: `Ch ${i}`,
      severity: 'minor',
      ...(i < 5 ? { status: 'accepted' } : {}),
    }))
  );

  it('shows the open rows, folds the decided ones behind one button, and explains the stage', async () => {
    const user = userEvent.setup();
    render(<ReviewRenderer {...props(bookStage('continuity'), { versions: [version(findings)] })} />);
    expect(screen.getByText('Finding 7')).toBeInTheDocument();
    expect(screen.queryByText('Finding 1')).not.toBeInTheDocument();
    expect(screen.getByText(/This is a check stage/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '5 already decided — show' }));
    expect(screen.getByText('Finding 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide the 5 already decided' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not fold a table that is all decided — there is nothing else to show', () => {
    const allDone = serializeItems(
      Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, finding: `Done ${i}`, where: 'x', severity: 'minor', status: 'accepted' }))
    );
    render(<ReviewRenderer {...props(bookStage('continuity'), { versions: [version(allDone)] })} />);
    expect(screen.getByText('Done 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /already decided/ })).not.toBeInTheDocument();
  });

  it('does not fold a short table', () => {
    const short = serializeItems([{ id: 'a', finding: 'Only one', status: 'accepted' }]);
    render(<ReviewRenderer {...props(bookStage('continuity'), { versions: [version(short)] })} />);
    expect(screen.getByText('Only one')).toBeInTheDocument();
  });
});

describe('a list stage that needs a status on every row', () => {
  // v1 authored Experiment as `list` with `every_item_has_status`. The list
  // renderer draws no status control, so "Every planned run has a result or a
  // reason — 10 still unresolved" could never be cleared. v2 fixed the
  // template; projects pinned to v1 stayed stuck. This is that v1 stage.
  const experimentV1: StageDefinition = { ...getStage(RESEARCH_V1, 'experiment')!, renderer: 'list' };
  const runs = serializeItems([
    { id: 'r1', run: 'Baseline', observed: 'Held', deviation: 'None' },
    { id: 'r2', run: 'Stress test', observed: 'Failed at 3x', deviation: 'Ran at 2.5x' },
  ]);

  it('is drawn with a status control, so the gate can be satisfied', () => {
    render(<StageRenderer {...props(experimentV1, { versions: [version(runs)] })} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText('2 still to resolve')).toBeInTheDocument();
  });

  it('satisfies the criterion once every row has a status', () => {
    const schema = itemSchemaFor(experimentV1);
    expect(schema.statuses?.length).toBeGreaterThan(0);
    const done = schema.statuses!.find((o) => !o.requiresReason)!.value;
    const resolved = parseItems(runs)!.map((r) => ({ ...r, status: done }));

    const evaluation = evaluateStage(
      { ...RESEARCH_V1, stages: RESEARCH_V1.stages.map((st) => (st.id === 'experiment' ? experimentV1 : st)) },
      'experiment',
      contextFrom(RESEARCH_V1 as typeof BOOK_V1, { experiment: serializeItems(resolved) })
    );
    expect(evaluation.criteria.find((c) => c.id === 'exp.results')!.satisfied).toBe(true);
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

  it('shows the current and saved versions, and the rest behind Full history (C6)', async () => {
    const user = userEvent.setup();
    const versions = [
      version('a', 1),
      { ...version('b', 2), id: 'v2', source_operation: 'stage_edit' },
      version('c', 3),
      version('d', 4),
    ];
    render(<ProseRenderer {...props(bookStage('objective'), { versions, activeVersionId: 'v4' })} />);
    const history = screen.getByRole('group', { name: 'Version history' });
    expect(within(history).getByRole('button', { name: /^v4 · current/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(history).getByRole('button', { name: /^v2 · saved/ })).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: /^v1/ })).not.toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: /^v3/ })).not.toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Full history (4)' }));
    expect(within(history).getByRole('button', { name: /^v1/ })).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: /^v3/ })).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Hide history' }));
    expect(within(history).queryByRole('button', { name: /^v3/ })).not.toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// A1d: dead ends on an empty prose stage
// ---------------------------------------------------------------------------

describe('an empty prose stage', () => {
  it('can be written by hand, as the empty state says', async () => {
    const user = userEvent.setup();
    const onSaveContent = vi.fn(async () => {});
    render(<ProseRenderer {...props(bookStage('objective'), { onSaveContent })} />);

    await user.click(screen.getByRole('button', { name: /Write it yourself/ }));
    await user.type(screen.getByRole('textbox', { name: /Edit/ }), 'My own objective.');
    await user.click(screen.getByRole('button', { name: 'Save as new version' }));

    expect(onSaveContent).toHaveBeenCalledWith('My own objective.');
  });

  it('says so when a save fails, and keeps the text', async () => {
    const user = userEvent.setup();
    const onSaveContent = vi.fn(async () => {
      throw new Error('network down');
    });
    render(<ProseRenderer {...props(bookStage('objective'), { onSaveContent })} />);

    await user.click(screen.getByRole('button', { name: /Write it yourself/ }));
    await user.type(screen.getByRole('textbox', { name: /Edit/ }), 'Keep me.');
    await user.click(screen.getByRole('button', { name: 'Save as new version' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Not saved: network down/);
    expect(screen.getByRole('textbox', { name: /Edit/ })).toHaveValue('Keep me.');
  });

  it('offers no writing on a stage being browsed read-only', () => {
    render(<ProseRenderer {...props(bookStage('objective'), { readOnly: true })} />);
    expect(screen.queryByRole('button', { name: /Write it yourself/ })).not.toBeInTheDocument();
  });
});
