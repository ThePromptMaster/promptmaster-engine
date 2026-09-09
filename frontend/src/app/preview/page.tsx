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
import { StageEvaluationPanel } from '@/components/workflow/evaluation-panel';
import { AppliedNotice, ChatPanel, ProposalCard } from '@/components/workflow/chat-panel';
import { itemSchemaFor, serializeItems } from '@/lib/workflow/stage-artifact';
import { DerivedOutlineNotice } from '@/components/outline/derived-outline-notice';
import { OutlineEditor } from '@/components/outline/outline-editor';
import { OutlineHistory } from '@/components/outline/outline-history';
import { deriveOutlineItems, derivedOutlineDrift } from '@/lib/workflow/derived-outline';
import { applyOutlineEdit } from '@/lib/outline/use-outline-draft';
import {
  newItem,
  outlineHistory,
  serializeOutlineDocument,
  staleDrafts,
} from '@/lib/outline/model';
import type { OutlineDocument, SectionDraftBinding } from '@/types/outline';
import type { Artifact, ArtifactVersion, Evaluation, Project } from '@/types/project';
import type { AuditFinding, LongFormState, StageRecommendation } from '@/types';
import { RecoveryPanel } from '@/components/workflow/recovery-panel';
import { ExportMenu } from '@/components/workflow/export-menu';
import { FeedbackForm } from '@/components/shared/feedback-form';
import { BETA_NOTICE_STORAGE_KEY } from '@/components/shared/beta-notice';
import { stageFailure } from '@/lib/errors/recovery';
import { ApiError } from '@/lib/api/client';
import type { ErrorCode } from '@/lib/jobs/errors';
import { StageRail } from '@/components/workflow/stage-rail';
import { ProjectSetup, stageWantsSetup } from '@/components/workflow/project-setup';
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

// --- Research fixtures ------------------------------------------------------
//
// The Research stages are here for the same reason the Book ones are: the hints
// that make a stage produce falsifiable propositions rather than an essay about
// hypotheses are only judgeable against the columns they fill. Each fixture is
// written as a plausible *good* answer to its stage's instruction, so the rows
// below are also the standard the prompt is aiming at.

const HYPOTHESIS_FIXTURE = serializeItems([
  {
    id: 'i1',
    statement: 'Queue latency above 400ms at p95 drives free-tier churn within a week.',
    prediction: 'Churn rises monotonically with p95 latency; roughly 2pp per 100ms above 400ms.',
    disconfirming_observation:
      'Churn flat across the 200–900ms range, or rising below 400ms as fast as above it.',
  },
  {
    id: 'i2',
    statement: 'The effect runs through failed retries, not through perceived slowness.',
    prediction: 'Controlling for retry failures removes most of the latency–churn association.',
    disconfirming_observation:
      'The association survives the control at close to full strength.',
  },
]);

const ALTERNATIVES_FIXTURE = serializeItems([
  {
    id: 'i1',
    explanation: 'High-latency periods coincide with the weekly billing job, so the churn is priced, not slow.',
    why_plausible: 'Both peaks land on Tuesdays; we never separated them.',
    how_addressed: 'Re-ran the comparison excluding Tuesdays; the effect held at 80% strength.',
    status: 'addressed',
  },
  {
    id: 'i2',
    explanation: 'Selection: accounts on the slowest shard were also the oldest free accounts.',
    why_plausible: 'Shard assignment predates the current placement policy.',
    how_addressed: 'Would need an account-age-matched sample we do not have.',
    status: 'left_open',
    reason: 'No matched sample this quarter; recorded for the next study.',
  },
]);

const VALIDATION_FIXTURE = serializeItems([
  {
    id: 'i1',
    result: 'Churn rises with p95 latency above 400ms.',
    attempt: 'Rerun on the following month, independent sample.',
    notes: 'Same direction, slope 1.6pp per 100ms against 2.0pp.',
    status: 'reproduced',
  },
  {
    id: 'i2',
    result: 'Retry failures mediate most of the effect.',
    attempt: 'None — the retry log rotates at 14 days.',
    notes: '',
    status: 'not_attempted',
    reason: 'Log retention is shorter than the observation window.',
  },
]);

function ResearchSlice({ stageId, content }: { stageId: string; content: string }) {
  const stage = getStage(RESEARCH_V1, stageId)!;
  return (
    <div className="rounded-2xl bg-[var(--surface)] px-8 py-8 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <StageRenderer
        stage={stage}
        schema={itemSchemaFor(stage)}
        versions={[fixtureVersion(content)]}
        activeVersionId={null}
        onSelectVersion={() => {}}
        onRestore={async () => {}}
        onSaveContent={async () => {}}
        onSaveItems={async () => {}}
        generating={false}
        generationError={null}
        onGenerate={() => {}}
        onCancelGeneration={() => {}}
        readOnly={false}
      />
    </div>
  );
}

/** What the stage generator is actually sent, so the authoring can be read. */
function InstructionSlice({ template }: { template: WorkflowTemplate }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      {template.stages.map((stage, i) => (
        <div
          key={stage.id}
          className={
            i % 2 === 0
              ? 'px-8 py-5'
              : 'bg-[var(--surface-container-lowest)] px-8 py-5'
          }
        >
          <div className="flex items-baseline gap-3">
            <span className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
              {i + 1}
            </span>
            <span className="text-body font-semibold text-[var(--on-surface)]">{stage.label}</span>
            <span className="text-label text-[var(--on-surface-variant)]">
              {stage.renderer}
            </span>
          </div>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">
            {stage.entry_prompt_hint}
          </p>
        </div>
      ))}
    </div>
  );
}

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

/**
 * Drafting, six sections in.
 *
 * The state that matters here is the one the old view could not represent:
 * three sections written and safe, one cut short at the model's output limit,
 * and the rest still to come — with no client-side loop anywhere. The counts
 * come from the artifact, so this is what a user sees after closing the tab and
 * coming back to find cron had carried on without them.
 */
const DRAFTING_PROJECT = {
  id: 'preview-project',
  user_id: 'preview-user',
  title: 'How to Become a PromptMaster',
  objective: 'Write a practical book on structured AI workflows.',
  audience: 'Analysts, auditors and strategists',
  constraints: '',
  output_format: '',
  mode: 'architect',
  custom_name: '',
  custom_preamble: '',
  custom_tone: '',
  model: 'openai/gpt-5.4',
  session_facts: [],
  active_stack_id: null,
  constraint_presets: [],
  format_presets: [],
  workflow: 'book',
  workflow_template_id: null,
  stage: 'drafting',
  status: 'active' as const,
  manual_checks: {},
  revision: 3,
  archived_at: null,
  deleted_at: null,
  legacy_session_id: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-05T10:00:00Z',
};

const DRAFTED_SECTIONS: Array<[string, 'complete' | 'truncated' | 'pending']> = [
  ['The problem with chatting', 'complete'],
  ['Modes as scaffolding', 'complete'],
  ['Evaluation before iteration', 'complete'],
  ['Drift, and how to see it', 'truncated'],
  ['Realignment in practice', 'pending'],
  ['Continuity across sections', 'pending'],
];

function draftingLongForm() {
  return {
    state: 'writing' as const,
    current_section_index: 3,
    started_at: '2026-09-05T09:00:00Z',
    completed_at: null,
    continuity_snapshot: null,
    outline: DRAFTED_SECTIONS.map(([title, kind], i) => ({
      id: `sec-${i}`,
      title,
      abstract: `What section ${i + 1} covers.`,
      status: (kind === 'pending' ? 'pending' : 'complete') as 'pending' | 'complete',
      content:
        kind === 'pending'
          ? ''
          : `Generated prose for "${title}". In the real artifact this runs to several paragraphs; here it is one line so the row layout is what you are judging.`,
      revision: kind === 'pending' ? 0 : 1,
      finish_reason: kind === 'truncated' ? 'length' : kind === 'pending' ? null : 'stop',
      error: null,
      generated_at: kind === 'pending' ? null : '2026-09-05T09:30:00Z',
    })),
  };
}

function DraftingSlice() {
  const stage = getStage(BOOK_V1, 'drafting')!;
  return (
    <div className="rounded-2xl bg-[var(--surface)] px-8 py-8 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <StageRenderer
        stage={stage}
        schema={itemSchemaFor(stage)}
        versions={[]}
        activeVersionId={null}
        onSelectVersion={() => {}}
        onRestore={async () => {}}
        onSaveContent={async () => {}}
        onSaveItems={async () => {}}
        generating={false}
        generationError={null}
        onGenerate={() => {}}
        onCancelGeneration={() => {}}
        readOnly={false}
        longForm={{
          project: DRAFTING_PROJECT as unknown as Project,
          artifactId: 'preview-artifact',
          stageId: 'drafting',
          state: draftingLongForm() as unknown as LongFormState,
          approvedOutlineVersionId: 'preview-outline-v2',
          onRefresh: () => {},
        }}
      />
    </div>
  );
}

/**
 * Stage evaluation — FR-11 and FR-12, reviewable without a login.
 *
 * The fixture is deliberately the defective case, because that is the one with
 * anything to look at: the positioning artifact below drifts on the objective,
 * ignores the approved outline and names vendors the constraints forbid, and
 * each of those is a finding categorised by the axis it offends.
 *
 * Both live states are shown — the control before it is pressed, saying what
 * it costs, and the panel afterwards. The recommendation carries FR-14's
 * rationale fields; "Carry on without it" is the one FR-12 response M4.1
 * implements, since accept/modify/reject are M4.2's surface.
 */
const EVAL_FINDINGS: AuditFinding[] = [
  {
    id: 'f1',
    category: 'objective',
    summary: 'Surveys the academic literature instead of positioning the book.',
    suggested_change: 'Name two comparable practitioner books and say what this does differently.',
  },
  {
    id: 'f2',
    category: 'audience',
    summary: 'Addresses doctoral candidates, not the engineering managers named upstream.',
    suggested_change: 'Rewrite for a manager who has to act on it this quarter.',
  },
  {
    id: 'f3',
    category: 'constraints',
    summary: 'Names two vendors, which the project constraints forbid.',
    suggested_change: 'Remove the vendor names.',
  },
  {
    id: 'f4',
    category: 'approved outline',
    summary: 'Promises chapters the approved outline does not contain.',
    suggested_change: 'Align the chapter list with the three approved sections.',
  },
];

const EVAL_FIXTURE: Evaluation = {
  id: 'e1',
  user_id: 'u',
  project_id: 'p',
  version_id: 'v1',
  alignment_score: 'Low',
  alignment_explanation: 'It never positions the book against anything.',
  drift_score: 'High',
  drift_explanation: 'Drifts on the objective, the audience and the approved outline.',
  clarity_score: 'Medium',
  clarity_explanation: 'Readable sentences, but no structure a reader can navigate.',
  completeness_status: 'incomplete',
  completeness_reason: 'No comparable books are named, which the stage requires.',
  interpretation: {
    label: 'What to improve',
    bullets: [
      'Answers a different question than the stage asked.',
      'No sections; one undifferentiated block.',
      'Contradicts the outline the draft is bound to.',
    ],
  },
  findings: EVAL_FINDINGS,
  needs_realignment: true,
  evaluator_model: 'anthropic/claude-sonnet',
  source: 'manual',
  created_at: '2026-09-09T00:00:00Z',
};

const EVAL_RECOMMENDATION: StageRecommendation = {
  id: 'r1',
  title: 'Rewrite the positioning against the approved outline',
  triggering_issue: 'Alignment Low and drift High across three of the five axes.',
  expected_benefit: 'A positioning statement the drafting stages can be judged against.',
  scope: 'The positioning stage only; the approved outline is untouched.',
  instruction: 'Rewrite naming two comparable practitioner books, no vendors, for managers.',
};

const DEFECTIVE_POSITIONING = `# Positioning

This book is a comprehensive survey of the academic literature on organisational
theory from 1954 onward, with extended treatment of the Carnegie School. It is
written for doctoral candidates preparing for comprehensive examinations, and
assumes familiarity with the bounded-rationality debates. Chapter one covers
prompt engineering syntax; chapter two covers vendor selection; chapter three
covers procurement contracts.

Recommended tooling: Acme CoPilot Enterprise and the Initech review suite.`;

function StageEvaluationSlice() {
  const stage = getStage(BOOK_V1, 'positioning')!;
  const [evaluated, setEvaluated] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[var(--surface)] px-8 py-8 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
        <StageRenderer
          stage={stage}
          schema={itemSchemaFor(stage)}
          versions={[fixtureVersion(DEFECTIVE_POSITIONING)]}
          activeVersionId={null}
          onSelectVersion={() => {}}
          onRestore={async () => {}}
          onSaveContent={async () => {}}
          onSaveItems={async () => {}}
          generating={false}
          generationError={null}
          onGenerate={() => {}}
          onCancelGeneration={() => {}}
          readOnly={false}
          evaluation={evaluated ? EVAL_FIXTURE : undefined}
          evaluating={evaluating}
          evaluationError={null}
          onEvaluate={() => {
            // Fakes the round trip so both states are reachable here; the real
            // call is one request to /api/evaluate-stage-artifact.
            setEvaluating(true);
            setTimeout(() => {
              setEvaluating(false);
              setEvaluated(true);
              setDismissed(false);
            }, 700);
          }}
        />
      </div>

      <div className="max-w-[420px]">
        <StageEvaluationPanel
          evaluation={evaluated ? EVAL_FIXTURE : undefined}
          recommendation={evaluated && !dismissed ? EVAL_RECOMMENDATION : null}
          onDismissRecommendation={() => setDismissed(true)}
        />
      </div>
    </div>
  );
}

// --- FR-16, FR-20, FR-22 slices ---------------------------------------------

const FAILURE_CODES: ErrorCode[] = [
  'insufficient_credits',
  'rate_limited',
  'context_length',
  'output_truncated',
  'function_timeout',
  'job_dead',
  'provider_unavailable',
  'invalid_request',
  'unknown',
];

/**
 * Every failure a user can hit, with the recovery each one actually offers.
 *
 * Rendered from the same `stageFailure` the workspace calls, so what is on
 * screen here is what ships — including the preservation sentence, which is
 * generated rather than written into the fixture.
 */
function RecoverySlice() {
  return (
    <div className="space-y-3">
      {FAILURE_CODES.map((code) => (
        <RecoveryPanel
          key={code}
          failure={stageFailure(
            new ApiError('classified upstream', 502, {
              code,
              technical: 'LLM error: OpenRouter API error: HTTP 402 insufficient_credits',
              retryAfter: code === 'rate_limited' ? 30 : null,
            }),
            { savedVersions: 6, label: 'positioning statement' }
          )}
          onRetry={() => {}}
          onDismiss={() => {}}
          onSwitchModel={() => {}}
          currentModel="anthropic/claude-sonnet"
        />
      ))}
    </div>
  );
}

// --- the side chat ----------------------------------------------------------

/** A project row with just enough on it for the chat's PMInput. */
const CHAT_PROJECT = {
  id: 'preview-project',
  user_id: 'preview-user',
  title: 'A field guide to governing AI-assisted work',
  objective: 'Explain how to govern AI-assisted work to a sceptical reviewer.',
  audience: 'Engineering leads at regulated companies',
  constraints: 'No tool reviews. No prompt technique.',
  output_format: 'Markdown',
  mode: 'architect',
  model: 'anthropic/claude-sonnet',
  workflow: 'book',
  stage: 'objective',
} as unknown as Project;

const CHAT_VERSION = fixtureVersion(PROSE_FIXTURE, 3);

/**
 * Both modes side by side.
 *
 * Two panels rather than one with a toggle, because the point being reviewed
 * is the difference between them — and that is not reviewable one at a time.
 * They carry different stage ids so they do not share a thread.
 */
function ChatModesSlice() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(['discuss', 'instruct'] as const).map((mode) => (
        <div key={mode} className="h-[560px]">
          <ChatPanel
            project={CHAT_PROJECT}
            stageId={`preview-chat-${mode}`}
            stageLabel="Objective"
            content={PROSE_FIXTURE}
            headVersion={CHAT_VERSION}
            initialMode={mode}
          />
        </div>
      ))}
    </div>
  );
}

function ExportSlice() {
  const project = {
    ...DRAFTING_PROJECT,
    title: 'Governing AI-assisted work',
    workflow: 'book',
    stage: 'research',
  } as Project;
  return (
    <div className="flex justify-end rounded-2xl bg-[var(--surface-container-low)] px-6 py-5">
      <ExportMenu
        bundle={{
          project,
          template: BOOK_V1,
          state: projectState(BOOK_V1, EVENTS, project.stage),
          events: EVENTS,
          stages: {
            objective: { artifact: null, versions: [fixtureVersion(PROSE_FIXTURE, 1)] },
            audience: { artifact: null, versions: [fixtureVersion(AUDIENCE_FIXTURE, 1)] },
          },
          evaluations: {},
        }}
      />
    </div>
  );
}

/**
 * The notice itself is mounted globally by the layout, so it is already on this
 * page. What the preview adds is a way back to it after dismissal, and the
 * feedback form on its own, at full size, where its four fields can be read.
 */
function BetaSlice() {
  return (
    <div className="space-y-4">
      <button
        onClick={() => {
          try {
            localStorage.removeItem(BETA_NOTICE_STORAGE_KEY);
          } catch {
            // Private window. The notice is showing anyway.
          }
          location.reload();
        }}
        className="rounded-xl bg-[var(--surface-container-high)] px-5 py-2.5 text-title text-[var(--on-surface)]"
      >
        Reset the beta notice and reload
      </button>
      <div className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-5">
        <FeedbackForm />
      </div>
    </div>
  );
}

/**
 * The two cards an instruction produces, with fixture content.
 *
 * The proposal card only appears after a model call, and the preview has no
 * backend — so these are rendered directly. They are the same components the
 * panel mounts; only the data is fabricated, which is the rule everywhere else
 * on this page.
 */
function ApplyFlowSlice() {
  const [state, setState] = useState<'proposed' | 'applied' | 'discarded'>('proposed');

  return (
    <div className="max-w-[520px] rounded-xl bg-[var(--surface-container-lowest)] px-5 py-4">
      {state === 'proposed' && (
        <ProposalCard
          scopeLabel="The section “What this is not” — 14 words"
          before={'## What this is not\n\nIt is **not** a book about prompting. Prompt technique dates in months; governance does not.'}
          after={'## What this is not\n\nThis is not a book about prompting. Prompt technique dates in months. Governance outlives it, which is why this book is about the second thing.'}
          canApply
          busy={false}
          onAccept={() => setState('applied')}
          onDiscard={() => setState('discarded')}
        />
      )}

      {state === 'applied' && (
        <AppliedNotice
          scope="The section “What this is not”"
          canUndo
          busy={false}
          onUndo={() => setState('proposed')}
          onDismiss={() => setState('discarded')}
        />
      )}

      {state === 'discarded' && (
        <div className="py-6 text-center">
          <p className="text-body text-[var(--on-surface-variant)]">
            Nothing was written. The artifact is exactly as it was.
          </p>
          <button
            onClick={() => setState('proposed')}
            className="mt-3 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
          >
            Propose it again
          </button>
        </div>
      )}
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

/**
 * The derived outline, derived — not a fixture of one.
 *
 * The items below come out of `deriveOutlineItems` against fabricated stage
 * summaries, so what is on the page is what the real function returns. That is
 * the point worth reviewing: the outline is a pure projection of work already
 * done, and the drift notice above it is the only thing that happens when an
 * earlier stage moves after approval.
 */
const DERIVED_CONCLUSIONS: Record<string, string> = {
  question: 'Does checkpointing at the section boundary preserve completed work across worker death?',
  literature: 'Prior queue designs restart the unit of work; none checkpoint mid-unit.',
  hypothesis: 'Checkpointing preserves every completed section; any regeneration disconfirms it.',
  method: 'Ten-section project, worker killed after section three, resumed; count regenerated sections.',
  experiment: 'Run 1: killed at section 3, resumed [complete]; Run 2: lease expired, reaped [complete].',
  analysis: 'Supported: three completed sections survived and none were regenerated.',
  validation: 'Re-ran the ten-section project on a second machine [reproduced].',
  mechanism: 'The lease, not the process, holds the claim, so a dead worker releases by expiry.',
  generality: 'Holds where a unit of work is externally durable; fails where the model call is the unit.',
};

/** The alternatives stage is skipped, so Threats to validity is dropped. */
const DERIVED_SKIPPED = ['alternatives'];

function derivedFixture() {
  const events: WorkflowEvent[] = [];
  const bundles: Record<string, { artifact: Artifact | null; versions: ArtifactVersion[] }> = {};

  for (const stage of RESEARCH_V1.stages) {
    if (stage.id === 'drafting') break;
    if (DERIVED_SKIPPED.includes(stage.id)) {
      events.push(ev('stage_skipped', stage.id, { reason: 'Alternatives ruled out by design' }));
      continue;
    }
    const summary = DERIVED_CONCLUSIONS[stage.id] ?? '';
    bundles[stage.id] = {
      artifact: { id: `a-${stage.id}`, summary } as unknown as Artifact,
      versions: [{ id: `v-${stage.id}`, content: summary } as unknown as ArtifactVersion],
    };
    events.push(ev('stage_completed', stage.id));
  }

  const state = projectState(RESEARCH_V1, events);
  return { items: deriveOutlineItems(RESEARCH_V1, state, bundles), state, bundles };
}

function DerivedOutlineSlice() {
  const { items, state, bundles } = derivedFixture();
  const head: OutlineDocument = { schema: 1, items, orphans: [] };
  const [draft, setDraft] = useState<OutlineDocument | null>(null);
  const doc = draft ?? head;

  // The analysis stage revised after approval: the drift the notice reports.
  const drift = derivedOutlineDrift(
    items,
    deriveOutlineItems(RESEARCH_V1, state, {
      ...bundles,
      analysis: {
        ...bundles.analysis,
        artifact: { ...bundles.analysis.artifact!, summary: 'Not supported after all.' },
      },
    })
  );

  return (
    <div className="space-y-4 rounded-2xl bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <DerivedOutlineNotice drift={drift} onRederive={() => setDraft(null)} />
      <OutlineEditor
        document={doc}
        onChange={(next) =>
          setDraft((current) =>
            applyOutlineEdit(
              { head, headVersionId: 'v1', headApproved: true, draft: current },
              next
            )
          )
        }
        isDraft={draft !== null}
        headVersionNumber={1}
        approvedVersionNumber={1}
        forkedFromVersionNumber={draft?.forked_from_version_id ? 1 : null}
        onSaveDraft={() => {}}
        onDiscardDraft={() => setDraft(null)}
        onApprove={() => {}}
        onRegenerateAll={() => {}}
        onRegenerateItem={() => {}}
      />
    </div>
  );
}

/**
 * Single output, stage by stage, with the controls live.
 *
 * The other slices on this page show a workflow's chrome around a grey block
 * standing in for its content. This one has to show the content, because
 * single output is the workflow that just stopped having a bespoke pane: the
 * question a reviewer needs answered is whether five stages of prose and review
 * renderers actually replace the five hand-written phases, and a placeholder
 * cannot answer it.
 *
 * Everything reacts. Typing an objective satisfies Input's blocking criterion
 * in front of you, ticking a manual check flips its row, and moving between
 * stages swaps the renderer — all through the same `evaluateStage` the app
 * runs. Only the artifacts are fixtures, and only because there is no model
 * behind a preview.
 */
const SINGLE_OUTPUT_FIXTURES: Record<string, string> = {
  input:
    'Produce a two-page briefing for the board on why the migration is worth its cost, ' +
    'in language a non-technical director can act on.',
  review:
    'You are writing for a board that has approved the budget but not the plan. ' +
    'Lead with the decision they have to make, then the evidence, then the risk you are asking them to accept.',
  output:
    '## The decision\n\nTwo systems now do the same job, and every change has to be made ' +
    'twice or consciously not made twice. The cost of the second one is not the code — it is ' +
    'the deliberation tax on everything else.\n\n## What we are asking\n\nApproval to retire ' +
    'the older path this quarter rather than next.',
  realign:
    'The draft argued from engineering convenience. Rewrite it to argue from the cost of ' +
    'delay, which is the only currency this audience spends.',
};

function SingleOutputSlice() {
  const template = SINGLE_OUTPUT_V1;
  const [stageId, setStageId] = useState(template.stages[0].id);
  const [objective, setObjective] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  const stage = getStage(template, stageId)!;
  const project = {
    ...DRAFTING_PROJECT,
    workflow: 'single_output',
    stage: stageId,
    objective,
    manual_checks: checks,
  } as Project;

  const content = SINGLE_OUTPUT_FIXTURES[stageId] ?? null;
  const items = stage.renderer === 'review' ? FACT_CHECK_FIXTURE : null;
  const shown = items ?? content;

  const context = ctx({
    fields: { objective },
    artifactNonEmpty: { [stageId]: Boolean(shown?.trim()) },
    manualChecks: checks,
  });
  const evaluation = evaluateStage(template, stageId, context);
  const state = projectState(template, [], stageId);
  const manualIds = new Set(
    stage.exit_criteria.filter((c) => c.check === 'manual').map((c) => c.id)
  );

  return (
    <div className="rounded-2xl bg-[var(--surface)] px-8 py-8 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <div className="mb-6 flex flex-wrap gap-2">
        {template.stages.map((s) => (
          <button
            key={s.id}
            onClick={() => setStageId(s.id)}
            className={`rounded-lg px-3 py-1.5 text-label transition-colors ${
              s.id === stageId
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
            }`}
          >
            {s.short_label}
            <span className="ml-2 opacity-60">{s.renderer}</span>
          </button>
        ))}
      </div>

      <StageHeader
        stage={stage}
        status={state.stages[stage.id]?.status ?? 'not_started'}
        position={{
          index: template.stages.findIndex((s) => s.id === stage.id) + 1,
          total: template.stages.length,
        }}
      />

      {stageWantsSetup(stage) && (
        <ProjectSetup
          project={project}
          stage={stage}
          onPatch={(patch) => setObjective(String(patch.objective ?? objective))}
          readOnly={false}
        />
      )}

      <div className="mb-6">
        <StageRenderer
          stage={stage}
          schema={itemSchemaFor(stage)}
          versions={shown === null ? [] : [fixtureVersion(shown)]}
          activeVersionId={null}
          onSelectVersion={() => {}}
          onRestore={async () => {}}
          onSaveContent={async () => {}}
          onSaveItems={async () => {}}
          generating={false}
          generationError={null}
          onGenerate={() => {}}
          onCancelGeneration={() => {}}
          readOnly={false}
        />
      </div>

      <div className="space-y-4">
        <ExitCriteriaChecklist
          criteria={evaluation.criteria}
          manualIds={manualIds}
          onToggleManual={(id, checked) => setChecks((c) => ({ ...c, [id]: checked }))}
        />
        <StageTransitionBar
          stage={stage}
          evaluation={evaluation}
          options={availableTransitions(template, state, evaluation)}
          onTransition={(option) => option.toStageId && setStageId(option.toStageId)}
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
            title="Evaluating a stage"
            note="FR-11 and FR-12. Press Evaluate — it says what it costs, because nothing here fires on its own. The artifact is deliberately defective: it answers a different question than the stage asked, addresses the wrong readers, names vendors the constraints forbid, and promises chapters the approved outline does not contain. Each is a finding, categorised by the axis it offends. The correction is offered, never applied; carrying on without it is a first-class answer."
          >
            <StageEvaluationSlice />
          </Section>

          <Section
            title="The drafting renderer"
            note="Sections are written by server jobs, so this component holds no generation state at all. Progress comes from the artifact and in-flight status from the job rows, which is why it stays honest after a tab close. The fourth section hit the model's output limit and says so."
          >
            <DraftingSlice />
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
            title="Research stages, rendered"
            note="Hypothesis through the list renderer, alternatives and validation through the review renderer — the same three components as Book, filled from the Research item schemas. The second alternative is left open with a reason, and the second result was never re-run; both are legitimate answers, and both are visible rather than absorbed."
          >
            <div className="space-y-6">
              <ResearchSlice stageId="hypothesis" content={HYPOTHESIS_FIXTURE} />
              <ResearchSlice stageId="alternatives" content={ALTERNATIVES_FIXTURE} />
              <ResearchSlice stageId="validation" content={VALIDATION_FIXTURE} />
            </div>
          </Section>

          <Section
            title="What each Research stage asks the model for"
            note="entry_prompt_hint, appended to the mode-locked system prompt. Not shown to the user anywhere in the app — this is the only place it can be read and judged. Each one ends with its failure mode, which is the clause that does the work."
          >
            <InstructionSlice template={RESEARCH_V1} />
          </Section>

          <Section
            title="The outline editor"
            note="FR-07. Reorder with the buttons or Alt+Arrow, insert between rows, and try editing a title: the outline is approved, so the first keystroke forks a draft rather than changing what drafting is bound to."
          >
            <OutlineSlice />
          </Section>

          <Section
            title="The derived outline"
            note="Research has no outline stage: the outline falls out of the twelve stages before it. Every brief below is the conclusion that stage recorded — no model call, and the same outline every time you look. Threats to validity is missing because the alternatives stage was skipped, and the notice above it is what a project sees when an earlier stage is revised after approval."
          >
            <DerivedOutlineSlice />
          </Section>

          <Section
            title="The legacy flow, now a template"
            note="The old five-phase session expressed as workflow data rather than a hard-coded path."
          >
            <WorkflowSlice template={SINGLE_OUTPUT_V1} />
          </Section>

          <Section
            title="When generation fails"
            note="FR-16. Nine classified failures, each with the actions that apply to it and none of the ones that do not — no retry where retrying is guaranteed to fail again, resume rather than retry where the work was interrupted. Every message says what survived, because the first question a failure raises is whether the work is gone. The raw provider error is behind Technical details, never the message."
          >
            <RecoverySlice />
          </Section>

          <Section
            title="Getting the work out"
            note="FR-20. Markdown is the artifact — every stage the project reached, in order, with a skipped stage recorded rather than dropped. The full record is project, stage history, every version and every evaluation: FR-01's durability claim made inspectable."
          >
            <ExportSlice />
          </Section>

          <Section
            title="The beta notice and feedback"
            note="FR-22. The notice is already on this page — it is mounted app-wide — and collapses to a chip rather than disappearing, because a warning a user can permanently delete is a warning that was never given. The form asks the four things the validation framework asks."
          >
            <BetaSlice />
          </Section>

          <Section
            title="Single output, stage by stage"
            note="/session is retired, so this is the whole of it. Pick a stage and the renderer changes with it — no branch anywhere reads the workflow's name. Type an objective on Input and watch its blocking criterion satisfy; tick a manual check and watch its row flip. Advance and Skip move between stages here rather than writing events."
          >
            <SingleOutputSlice />
          </Section>

          <Section
            title="The side chat, in both modes"
            note="Two powers in one input box, so the whole design is making it obvious which one you are about to use. Discuss states that it cannot change the document and offers no scope; Instruct shows what it would apply to before it applies it. Both panels are the real component — the model is not reachable from the preview, so sending will report a failure rather than reply."
          >
            <ChatModesSlice />
          </Section>

          <Section
            title="Proposing, applying, and undoing"
            note="FR-09 asks for the affected scope to be shown before application and the prior version to remain recoverable. Both halves of that sentence are on the proposal card, at the point of decision rather than as a property of the system you are expected to know."
          >
            <ApplyFlowSlice />
          </Section>
        </div>
      </div>
    </div>
  );
}
