'use client';

/**
 * Design preview. Dev-only — see the notFound() guard below.
 *
 * Renders the real workflow components against fixture data so the UI can be
 * reviewed without a login. Every surface here imports the same component the
 * app does, so what you see is what ships; only the data is fabricated.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';

import { WorkflowPicker } from '@/components/projects/workflow-picker';
import { StageRenderer } from '@/components/workflow/renderers/stage-renderer';
import { itemSchemaFor, serializeItems } from '@/lib/workflow/stage-artifact';
import { OutlineEditor } from '@/components/outline/outline-editor';
import { OutlineHistory } from '@/components/outline/outline-history';
import { applyOutlineEdit } from '@/lib/outline/use-outline-draft';
import {
  newItem,
  outlineHistory,
  serializeOutlineDocument,
  staleDrafts,
} from '@/lib/outline/model';
import type { OutlineDocument, SectionDraftBinding } from '@/types/outline';
import type { ArtifactVersion } from '@/types/project';
import { StageRail } from '@/components/workflow/stage-rail';
import { StageHeader } from '@/components/workflow/stage-header';
import { ExitCriteriaChecklist } from '@/components/workflow/exit-criteria-checklist';
import { StageTransitionBar } from '@/components/workflow/stage-transition-bar';
import {
  BOOK_V1,
  RESEARCH_V1,
  SINGLE_OUTPUT_V1,
  availableTransitions,
  evaluateStage,
  getStage,
  nextSuggestedStage,
  progressSummary,
  projectState,
} from '@/lib/workflow';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';

const TEMPLATES = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1].map((t, i) => ({
  ...t,
  id: `tpl-${i}`,
}));

const ev = (
  type: WorkflowEvent['type'],
  stage_id: string,
  extra: Partial<WorkflowEvent> = {}
): WorkflowEvent => ({
  type,
  stage_id,
  actor: 'user',
  created_at: '2026-09-04T00:00:00Z',
  ...extra,
});

/** A book part-way through: two stages done, one skipped with a reason. */
const EVENTS: WorkflowEvent[] = [
  ev('stage_completed', 'objective', { to_stage_id: 'audience' }),
  ev('stage_completed', 'audience', { to_stage_id: 'positioning' }),
  ev('stage_skipped', 'positioning', { to_stage_id: 'research', reason: 'Not a commercial book' }),
];

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: { objective: 'A field guide to governing AI-assisted work.' },
    itemCounts: { research: 1 },
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

// --- renderer fixtures ------------------------------------------------------

function fixtureVersion(content: string, n = 1): ArtifactVersion {
  return {
    id: `v${n}`,
    user_id: 'u',
    project_id: 'p',
    artifact_id: 'a',
    version_number: n,
    parent_version_id: null,
    source_operation: 'stage_draft',
    instruction: '',
    system_prompt: '',
    content,
    model: 'anthropic/claude-sonnet',
    mode: 'architect',
    change_summary: null,
    restored_from_version_id: null,
    finish_reason: 'stop',
    user_rating: null,
    continuity_snapshot: null,
    created_at: '2026-09-04T00:00:00Z',
  };
}

const PROSE_FIXTURE = `This book is for people who are already shipping work that an AI helped
write, and who have been asked — by a regulator, a client, or their own board —
to explain how.

It is **not** a book about prompting. Prompt technique dates in months;
governance does not.

Out of scope: model selection, cost optimisation, and anything that reads as a
tool review.`;

const AUDIENCE_FIXTURE = serializeItems([
  {
    id: 'i1',
    who: 'Engineering leads at regulated companies',
    prior_knowledge: 'Fluent with the tools, no vocabulary for defending their use.',
    what_they_want: 'Something they can hand to an auditor without translating it first.',
  },
  {
    id: 'i2',
    who: 'Independent consultants',
    prior_knowledge: 'Have been asked "did an AI write this?" and did not enjoy answering.',
    what_they_want: 'A defensible process, not a disclaimer.',
  },
]);

const FACT_CHECK_FIXTURE = serializeItems([
  {
    id: 'i1',
    claim: 'Most organisations have no written policy on AI-assisted drafting.',
    source: 'Industry survey, 2025',
    where: 'Chapter 2, opening',
    status: 'verified',
  },
  {
    id: 'i2',
    claim: 'Nine in ten reviewers cannot tell AI-assisted prose from human prose.',
    source: 'Unclear — heard secondhand',
    where: 'Chapter 4',
    status: 'unverifiable',
    reason: 'No primary source; the figure traces back to a blog post citing itself.',
  },
  {
    id: 'i3',
    claim: 'Regulators have begun requiring disclosure.',
    source: '',
    where: 'Chapter 7',
  },
]);

function RendererSlice({
  stageId,
  content,
  generating = false,
}: {
  stageId: string;
  content: string | null;
  generating?: boolean;
}) {
  const stage = getStage(BOOK_V1, stageId)!;
  return (
    <div className="rounded-2xl bg-[var(--surface)] px-8 py-8 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <StageRenderer
        stage={stage}
        schema={itemSchemaFor(stage)}
        versions={content === null ? [] : [fixtureVersion(content)]}
        activeVersionId={null}
        onSelectVersion={() => {}}
        onRestore={async () => {}}
        onSaveContent={async () => {}}
        onSaveItems={async () => {}}
        generating={generating}
        generationError={null}
        onGenerate={() => {}}
        onCancelGeneration={() => {}}
        readOnly={false}
      />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-headline text-[var(--on-surface)]">{title}</h2>
      {note && <p className="mt-1 mb-5 text-body text-[var(--on-surface-variant)]">{note}</p>}
      <div className={note ? '' : 'mt-5'}>{children}</div>
    </section>
  );
}

// --- outline fixtures -------------------------------------------------------

const OUTLINE_SECTIONS: Array<[string, string]> = [
  ['Why governance fails quietly', 'The failure mode is not refusal; it is unexamined acceptance.'],
  ['What a review actually checks', 'Separating the claim, the evidence, and the reviewer’s job.'],
  ['Writing the rule down', 'Turning a norm into something a new joiner can follow on day one.'],
  ['When to break your own rule', 'Guidance is suggestive, not restrictive — and the exceptions prove it.'],
];

function outlineFixture(): OutlineDocument {
  return {
    schema: 1,
    items: OUTLINE_SECTIONS.map(([title, abstract], i) =>
      newItem({ id: `sec-${i + 1}`, title, abstract })
    ),
    orphans: [
      {
        item_id: 'sec-orphan',
        title: 'A chapter on tooling',
        abstract: 'Cut from the outline; the writing was kept.',
        reason: 'regenerated',
        orphaned_at: '2026-09-03T00:00:00Z',
      },
    ],
  };
}

/** Two sections written, one of them against the outline before this one. */
const OUTLINE_DRAFTS: SectionDraftBinding[] = [
  { item_id: 'sec-1', outline_version_id: 'v2', word_count: 2140 },
  { item_id: 'sec-2', outline_version_id: 'v1', word_count: 1680 },
  { item_id: 'sec-orphan', outline_version_id: 'v1', word_count: 940 },
];

const OUTLINE_VERSIONS = [1, 2].map(
  (n) =>
    ({
      id: `v${n}`,
      version_number: n,
      content: serializeOutlineDocument(outlineFixture()),
      change_summary: n === 1 ? 'First pass' : 'Split the middle chapter',
      created_at: `2026-09-0${n + 1}T00:00:00Z`,
    }) as ArtifactVersion
);

/**
 * The outline stage as it behaves, not a screenshot of it: the fixture routes
 * every edit through the real copy-on-write rule, so editing the approved
 * outline below actually forks a draft.
 */
function OutlineSlice() {
  const head = outlineFixture();
  const [draft, setDraft] = useState<OutlineDocument | null>(null);
  const doc = draft ?? head;

  return (
    <div className="rounded-2xl bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <OutlineEditor
        document={doc}
        onChange={(next) =>
          setDraft((current) =>
            applyOutlineEdit({ head, headVersionId: 'v2', headApproved: true, draft: current }, next)
          )
        }
        drafts={OUTLINE_DRAFTS}
        staleDrafts={staleDrafts(OUTLINE_DRAFTS, 'v2', OUTLINE_VERSIONS)}
        onRewriteSection={() => {}}
        isDraft={draft !== null}
        headVersionNumber={2}
        approvedVersionNumber={2}
        forkedFromVersionNumber={draft?.forked_from_version_id ? 2 : null}
        onSaveDraft={() => {}}
        onDiscardDraft={() => setDraft(null)}
        onApprove={() => {}}
        onRegenerateAll={() => {}}
        onRegenerateItem={() => {}}
      />
      <div className="mt-4">
        <OutlineHistory
          history={outlineHistory(OUTLINE_VERSIONS, [
            { outline_version_id: 'v1', created_at: '2026-09-02T00:00:00Z' },
            { outline_version_id: 'v2', created_at: '2026-09-03T00:00:00Z' },
          ])}
          approvedVersionId="v2"
          onRestore={() => {}}
        />
      </div>
    </div>
  );
}

function WorkflowSlice({ template }: { template: WorkflowTemplate }) {
  const events = template.key === 'book' ? EVENTS : [];
  const state = projectState(template, events);
  const stage = getStage(template, state.current_stage_id)!;
  const context = ctx();
  const evaluation = evaluateStage(template, stage.id, context);
  const transitions = availableTransitions(template, state, evaluation);
  const progress = progressSummary(template, state);
  const manualIds = new Set(
    stage.exit_criteria.filter((c) => c.check === 'manual').map((c) => c.id)
  );

  return (
    <div className="flex overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <aside className="w-[248px] shrink-0 self-start bg-[var(--surface-container-lowest)] px-2 py-6">
        <div className="mb-4 px-3">
          <div className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            {template.name}
          </div>
          <div className="mt-1 text-label text-[var(--on-surface-variant)]">
            {progress.complete} done
            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
            {` · ${progress.remaining} to go`}
          </div>
        </div>
        <StageRail
          template={template}
          state={state}
          nextSuggestedId={nextSuggestedStage(template, state)}
          onSelect={() => {}}
        />
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">
        <StageHeader
          stage={stage}
          status={state.stages[stage.id]?.status ?? 'not_started'}
          position={{
            index: template.stages.findIndex((x) => x.id === stage.id) + 1,
            total: template.stages.length,
          }}
        />
        <div className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-6 py-6">
          <div className="mb-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)] opacity-70">
            {stage.renderer} renderer
          </div>
          <div className="space-y-2.5" aria-hidden>
            {[100, 92, 96, 74, 88, 60].map((w, i) => (
              <div
                key={i}
                className="h-3 rounded bg-[var(--surface-container-high)]"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <ExitCriteriaChecklist
            criteria={evaluation.criteria}
            manualIds={manualIds}
            onToggleManual={() => {}}
          />
          <StageTransitionBar
            stage={stage}
            evaluation={evaluation}
            options={transitions}
            onTransition={() => {}}
          />
        </div>
      </main>
    </div>
  );
}

export default function PreviewPage() {
  // Never ships. The preview exists so the UI can be reviewed without a login;
  // exposing fixture-driven screens in production would be worse than useless.
  if (process.env.NODE_ENV === 'production') notFound();

  const [pickerId, setPickerId] = useState<string | null>(TEMPLATES[0].id);

  return (
    <div className="min-h-screen bg-[var(--surface)] px-8 py-12">
      <div className="mx-auto max-w-[1200px]">
        <p className="mb-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          Design preview · fixture data · not deployed
        </p>
        <h1 className="text-display text-[var(--on-surface)]">Phase 2 workflow UI</h1>

        <div className="mt-14">
          <Section
            title="Choosing a workflow"
            note="Shown at project creation. The cards show the shape of the work, not just its name."
          >
            <WorkflowPicker templates={TEMPLATES} selectedId={pickerId} onSelect={setPickerId} />
          </Section>

          <Section
            title="The prose renderer"
            note="Read view with version pills. Edit swaps in a Markdown textarea with a preview toggle, and Save appends a version rather than overwriting one."
          >
            <RendererSlice stageId="objective" content={PROSE_FIXTURE} />
          </Section>

          <Section
            title="The list renderer"
            note="Fields come from the item schema, so the same component draws audience segments here and hypotheses in Research. Reorder is buttons before drag — drag alone is unusable at thirty rows."
          >
            <RendererSlice stageId="audience" content={AUDIENCE_FIXTURE} />
          </Section>

          <Section
            title="The review renderer"
            note="A real table. Statuses that dismiss a row demand a reason; the third row has no status at all, which is what keeps the stage's exit criterion unmet."
          >
            <RendererSlice stageId="fact_check" content={FACT_CHECK_FIXTURE} />
          </Section>

          <Section
            title="An empty stage, and one mid-draft"
            note="No stage opens blank — entering one starts a draft. This is what the two states look like."
          >
            <div className="space-y-6">
              <RendererSlice stageId="positioning" content={null} />
              <RendererSlice stageId="positioning" content={null} generating />
            </div>
          </Section>

          <Section
            title="Book, three stages in"
            note="Objective and Audience complete, Positioning skipped with a reason, now on Research. The rail groups 13 stages into phases."
          >
            <WorkflowSlice template={BOOK_V1} />
          </Section>

          <Section
            title="Research, on the same engine"
            note="Different stages, different criteria — identical components. Nothing below branches on which workflow it is."
          >
            <WorkflowSlice template={RESEARCH_V1} />
          </Section>

          <Section
            title="The outline editor"
            note="FR-07. Reorder with the buttons or Alt+Arrow, insert between rows, and try editing a title: the outline is approved, so the first keystroke forks a draft rather than changing what drafting is bound to."
          >
            <OutlineSlice />
          </Section>

          <Section
            title="The legacy flow, now a template"
            note="The old five-phase session expressed as workflow data rather than a hard-coded path."
          >
            <WorkflowSlice template={SINGLE_OUTPUT_V1} />
          </Section>
        </div>
      </div>
    </div>
  );
}
