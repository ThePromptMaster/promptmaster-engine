/**
 * Carrying out one move (B4). The only impure module in lib/agent.
 *
 * One performer per registry entry (actions.ts), each returning what actually
 * happened — the label is derived from that (labels.ts), never read off a
 * model response. Every write goes through the same modules the buttons use,
 * so a Go-mode draft is a version like any other, and a Go-mode stage move is
 * a workflow event the database checks like any other.
 */

import { api } from '@/lib/api/client';
import { awaitSectionJobs, type WaitResult } from '@/lib/jobs/await';
import { enqueueDraftJobs, enqueueRevisionJobs } from '@/lib/jobs/sections';
import { generateOutlineDraft } from '@/lib/outline/actions';
import { countNamedSections, parseOutlineDocument } from '@/lib/outline/model';
import { commitOutlineVersion } from '@/lib/supabase/outline';
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
import { appliedFindingsVersion, carryUserFields, findingsInstruction, reviseWithFindings } from '@/lib/workflow/apply-findings';
import { findInstructionConflicts } from '@/lib/workflow/conflict-trail';
import { describeWith, type InstructionConflict } from '@/lib/workflow/instruction-conflicts';
import { defaultOutlineForm, deriveOutlineItems } from '@/lib/workflow/derived-outline';
import { confirmableProposals, itemSchemaFor, parseItems, proposableStatuses, rendererHoldsItems, serializeItems } from '@/lib/workflow/stage-artifact';
import { enoughWorksFound, lookupQueries, recordLine, rowsFromSearch } from '@/lib/workflow/lookup';
import { lookupAndVerify } from '@/lib/workflow/verify';
import { figuresFromOutput, readStageFigures, withRunFigures, type StageFigures } from '@/lib/workflow/figures';
import { applyRunBlocked, applyRunResult } from '@/lib/workflow/run-result';
import { inputsChanged, stageInputs } from '@/lib/workflow/stage-inputs';
import { applyTriage } from '@/lib/workflow/triage';
import { proposeTargets } from '@/lib/workflow/proposals';
import { proposeStatuses } from '@/lib/workflow/propose';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { summariseStageContent } from '@/lib/workflow/digest';
import { stageContentForSummary, stageEvidence } from '@/lib/workflow/evidence';
import { blocksCompletion, deliverableStage, describeOutstanding, evaluateStage, outstandingWork } from '@/lib/workflow/engine';
import { pausedLine } from '@/lib/workflow/objective';
import { attachedDocuments, currentFacts, supersededFactValues } from '@/lib/workflow/facts';
import { describeValue, leftoverValues, type SupersededValue } from '@/lib/workflow/fact-values';
import { recordPolicyFacts } from '@/lib/supabase/facts';
import { checkGoal } from './code-check';
import { figureFindings, figureSources } from '@/lib/workflow/figure-support';
import { asIteration } from '@/lib/workflow/legacy';
import {
  evaluationRecord,
  evaluationRequest,
  generationContent,
  generationRequest,
  inputsFrom,
} from '@/lib/workflow/stage-requests';
import type { StageContext, StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import type { AgentRun, AgentStep, BlockKind, ExecutionLabel } from '@/types/agent';
import type { OutlineSection } from '@/types';
import type { Evaluation, Project } from '@/types/project';
import { actionFor, AWAIT_SECTIONS_STEP, INTERPRET_STEP } from './actions';
import type { AgentStateDigest } from './digest';
import type { StageFacts } from './facts';
import type { NeedsUser } from './needs';
import { deriveExecutionLabel } from './labels';
import { stageMoveActor } from './policy';

export interface PerformContext {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  context: StageContext;
  approvedOutline: OutlineSection[];
  run: AgentRun;
  step: AgentStep;
  digest: AgentStateDigest;
  /** The user pressed Approve on this move (Guided / Checkpoint). */
  approvedByUser: boolean;
  /** For a follow-up interpretation: the run it reads. */
  interpret?: { sandboxRunId: string; code: string; stdout: string; stderr: string; exitCode: number | null };
  deliverableDone: boolean;
  /** What the stage holds, read fresh (B1). */
  facts?: StageFacts;
  latestEvaluation?: Evaluation | null;
  /**
   * The user's answer to "which takes priority?", when this run asked it on
   * this stage and no revision has been made since. The revision then goes
   * ahead, carrying the answer, instead of asking again.
   */
  conflictAnswer?: string;
  /** A Derive/Prove result on this stage not yet saved (C4): a revision applies it. */
  derived?: { label: string; output: string };
  /** Re-read the project after a write that the store did not make itself. */
  refresh?: () => unknown;
  /** Live progress for a long step ("2 of 5 sections written"). */
  onProgress?: (text: string) => void;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  recordStageEvaluation?: (stageId: string, versionId: string, evaluation: NewEvaluation) => Promise<Evaluation>;
  setStageSummary?: (stageId: string, summary: string) => Promise<void>;
  setStageFigures?: (stageId: string, figures: StageFigures) => Promise<void>;
  /** Re-read the event log (and move the cursor) after a stage event. */
  afterStageEvent: () => Promise<void>;
  /** Tick an approval the routine-decision policy committed; the event is written first, by the performer. */
  commitCriterion?: (stageId: string, criterionId: string) => Promise<void>;
  signal: AbortSignal;
}

export interface StepOutcome {
  /** `interrupted`: the step could not finish here (a wait ran out); the work goes on in the background. */
  status: 'succeeded' | 'failed' | 'blocked' | 'interrupted';
  label: ExecutionLabel | null;
  output: string;
  blockKind?: BlockKind | null;
  toolsUsed: string[];
  changes: AgentStep['changes'];
  params?: Record<string, unknown>;
  /** run_computation ran code: interpret it next, without asking the planner. */
  followUp?: { sandboxRunId: string; code: string; stdout: string; stderr: string; exitCode: number | null };
  /** End the run after this step. */
  stop?: { status: 'completed' | 'awaiting_decision' | 'blocked'; reason: string };
  /** What the run needs from the user now (B4): the card with its one button. */
  needs?: NeedsUser;
  /** The step changed nothing and repeated a stop already made: it is not counted against the window. */
  free?: boolean;
}

const MAX_OUTPUT = 6_000;
/** WriteCodeRequest.goal's cap in routers/agent.py. The goal can come from the model, so it is clipped rather than trusted. */
const MAX_GOAL = 2_000;

function clip(text: string): string {
  return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + '\n[… trimmed …]' : text;
}

function done(actionKey: string, partial: Omit<StepOutcome, 'label'> & { sandboxLabel?: ExecutionLabel | null; interpretedRunId?: string | null }): StepOutcome {
  const { sandboxLabel, interpretedRunId, ...rest } = partial;
  return {
    ...rest,
    label: deriveExecutionLabel(actionKey, { blocked: rest.status === 'blocked', sandboxLabel, interpretedRunId }),
  };
}

/** Wait for the sections a step queued, and say what happened to each. */
async function waitForSections(ctx: PerformContext, key: string, ids: string[], verb: string): Promise<StepOutcome> {
  const m = ctx.facts?.manuscript;
  if (!m) return done(key, { status: 'failed', output: 'This stage has no manuscript.', toolsUsed: [], changes: {} });
  const title = (id: string) => m.outline.find((s) => s.id === id)?.title || id;
  const r: WaitResult = await awaitSectionJobs({
    projectId: ctx.project.id, artifactId: m.artifact.id, sectionIds: ids, signal: ctx.signal,
    onProgress: (s) => ctx.onProgress?.(`${s.complete} of ${s.total} sections written`),
  });
  ctx.refresh?.();
  const changes = { jobs: ids, sections_written: r.written };
  const wrote = r.written.length ? `${verb} ${r.written.length} section${r.written.length === 1 ? '' : 's'}: ${r.written.map(title).join('; ')}.` : `${verb} nothing yet.`;
  const standing = ` ${r.complete} of ${r.total} written.`;
  switch (r.outcome) {
    case 'done':
      return done(key, { status: 'succeeded', toolsUsed: ['model', 'jobs'], changes, output: wrote + standing });
    case 'failed':
      return done(key, {
        status: 'failed', toolsUsed: ['model', 'jobs'], changes,
        output: `${wrote} ${r.failed.length} could not be written: ${r.failed.map((f) => `${f.title} — ${f.message}`).join('; ')}.${standing}`,
      });
    case 'paused':
      return done(key, {
        status: 'interrupted', toolsUsed: ['model', 'jobs'], changes,
        output: `${wrote} Stopped while ${r.pending.length} section${r.pending.length === 1 ? ' was' : 's were'} still being written; they continue in the background.${standing}`,
        needs: { kind: 'wait_for_jobs', stageId: ctx.stage.id, pending: r.pending.length, complete: r.complete, total: r.total },
      });
    default:
      return done(key, {
        status: 'interrupted', toolsUsed: ['model', 'jobs'], changes,
        output: `${wrote} ${r.pending.length} still being written when the wait ran out; they continue in the background.${standing}`,
        needs: { kind: 'wait_for_jobs', stageId: ctx.stage.id, pending: r.pending.length, complete: r.complete, total: r.total },
      });
  }
}

/**
 * A revision Go chose for itself is an instruction like any the user types:
 * if it contradicts the objective, the constraints or a decision already
 * made, Go stops and asks which takes priority instead of quietly rewriting
 * the work (1 Oct, item 33).
 */
function askWhichTakesPriority(key: string, params: Record<string, unknown>, instruction: string, conflicts: InstructionConflict[]): StepOutcome {
  const c = conflicts[0];
  const question =
    `Before I change this: "${instruction.replace(/\s+/g, ' ').slice(0, 200)}" conflicts with ${describeWith(c)}. ` +
    `${c.explanation.trim()} Which should take priority?`;
  return done(key, {
    status: 'blocked', blockKind: 'needs_decision', toolsUsed: ['model'], changes: {},
    output: question, params: { ...params, conflict_question: true },
    stop: { status: 'awaiting_decision', reason: question },
    needs: { kind: 'answer_question', question },
  });
}

/**
 * What a clean run leaves on the project, beyond its own `sandbox_runs` row:
 * the row of the stage's table it carried out, when the planner named one and
 * the table is one a run can settle; and the labelled results it printed, on
 * the stage's figures. Neither is essential — a failure here leaves the run
 * recorded and says nothing more.
 */
async function recordRun(
  ctx: PerformContext,
  rowNumber: unknown,
  run: { id: string; stdout: string }
): Promise<{ changes: AgentStep['changes']; notes: string[] }> {
  const changes: AgentStep['changes'] = {};
  const notes: string[] = [];
  const bundle = ctx.bundles[ctx.stage.id];
  let head = bundle?.versions.at(-1);
  try {
    const schema = itemSchemaFor(ctx.stage);
    const rows = rendererHoldsItems(ctx.stage.renderer) ? parseItems(head?.content) : null;
    const result = rows && ctx.appendStageVersion ? applyRunResult(rows, rowNumber, schema, run) : null;
    if (result && ctx.appendStageVersion) {
      const statusLabel = schema.statuses?.find((s) => s.value === result.row.status)?.label ?? result.row.status;
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content: serializeItems(result.items),
        source_operation: 'sandbox_result',
        instruction: ctx.step.rationale || 'Go mode ran the computation.',
        model: '',
        mode: ctx.project.mode,
        change_summary: `Row ${rowNumber} marked ${statusLabel}: the code ran in the sandbox (run ${run.id.slice(0, 8)}).`,
      });
      const id = (created as { id?: unknown } | null)?.id;
      if (typeof id === 'string') {
        changes.version_ids = [id];
        changes.items_run = [result.row.id];
        head = { ...(head ?? {}), id, content: serializeItems(result.items) } as typeof head;
        notes.push(`Recorded on the table: row ${rowNumber} is now "${statusLabel}", with what the run printed. Change it if the run was not that row.`);
      }
    }
    const printed = figuresFromOutput(run.stdout, run.id);
    const figures = head && bundle?.artifact && ctx.setStageFigures ? withRunFigures(bundle.artifact.key_figures, head.id, printed) : null;
    if (figures && ctx.setStageFigures) {
      await ctx.setStageFigures(ctx.stage.id, figures);
      changes.figures_recorded = printed.length;
      notes.push(`Recorded ${printed.length} figure${printed.length === 1 ? '' : 's'} the code printed; later stages are given ${printed.length === 1 ? 'it' : 'them'} once this stage is complete.`);
    }
  } catch {
    // The run itself is on record; what could not be added is simply not claimed.
  }
  return { changes, notes };
}

/**
 * A run that was blocked for want of data, onto the row it was for: the row
 * becomes "Not run" with the reason the run gave, so the table agrees with
 * the step and the user is not asked to type that reason again.
 */
async function recordBlockedRun(
  ctx: PerformContext,
  rowNumber: unknown,
  blocked: { runId: string | null; reason: string }
): Promise<{ changes: AgentStep['changes']; notes: string[] }> {
  try {
    const schema = itemSchemaFor(ctx.stage);
    const rows = rendererHoldsItems(ctx.stage.renderer) ? parseItems(ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content) : null;
    const result = rows && ctx.appendStageVersion ? applyRunBlocked(rows, rowNumber, schema, blocked) : null;
    if (!result || !ctx.appendStageVersion) return { changes: {}, notes: [] };
    const statusLabel = schema.statuses?.find((s) => s.value === result.row.status)?.label ?? result.row.status;
    const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
      content: serializeItems(result.items),
      source_operation: 'sandbox_result',
      instruction: ctx.step.rationale || 'Go mode tried to run the computation.',
      model: '',
      mode: ctx.project.mode,
      change_summary: `Row ${rowNumber} marked ${statusLabel}: the run could not be made. ${blocked.reason}`.slice(0, 300),
    });
    const id = (created as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return { changes: {}, notes: [] };
    return {
      changes: { version_ids: [id], items_run: [result.row.id] },
      notes: [`Recorded on the table: row ${rowNumber} is now "${statusLabel}", with this reason. Change it if that is not right.`],
    };
  } catch {
    // The step itself says what happened; what could not be added to the table is simply not claimed.
    return { changes: {}, notes: [] };
  }
}

const SEARCH_RESULTS = 8;
/** LiteratureSearchRequest.query's cap in routers/agent.py. */
const MAX_QUERY = 300;

/**
 * Search the index by topic and, on the stage whose rows are works, add what
 * it found as rows the tool retrieved. From any other stage the records are
 * reported and nothing is saved. What each work says is not claimed anywhere:
 * the search read an index, not the works.
 */
async function searchLiterature(ctx: PerformContext, key: string, wanted: string): Promise<StepOutcome> {
  const query = wanted.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  if (!query) return done(key, { status: 'failed', toolsUsed: [], changes: {}, output: 'There was nothing to search for: no search words were given and the project has no objective.' });
  const { works, reached } = await api.agentLiteratureSearch(query, SEARCH_RESULTS, ctx.signal);
  const params = { ...(ctx.step.params ?? {}), query };
  if (!reached) {
    return done(key, { status: 'failed', toolsUsed: [], changes: {}, params, output: `OpenAlex could not be reached, so nothing was looked up for "${query}". Try again.` });
  }
  if (!works.length) {
    return done(key, { status: 'succeeded', toolsUsed: ['search'], changes: {}, params, output: `OpenAlex returned no records for "${query}". Nothing was added.` });
  }
  const schema = itemSchemaFor(ctx.stage);
  const holds = Boolean(schema.lookup?.search) && rendererHoldsItems(ctx.stage.renderer);
  const rows = holds ? parseItems(ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content) ?? [] : [];
  const added = holds ? rowsFromSearch(works, rows, schema) : [];
  const plural = (n: number) => `${n} work${n === 1 ? '' : 's'}`;
  let versionIds: string[] = [];
  if (added.length && ctx.appendStageVersion) {
    const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
      content: serializeItems([...rows, ...added]),
      source_operation: 'literature_search',
      instruction: ctx.step.rationale || 'Go mode searched for works.',
      model: '',
      mode: ctx.project.mode,
      change_summary: `Found in OpenAlex for "${query}": ${plural(added.length)} added.`.slice(0, 300),
    });
    const id = (created as { id?: unknown } | null)?.id;
    if (typeof id === 'string') versionIds = [id];
  }
  const saved = versionIds.length > 0;
  const lines = [
    `Searched OpenAlex for "${query}": ${plural(works.length)} returned.`,
    ...works.map((m) => `- ${recordLine(m)}${m.doi ? ` — ${m.doi}` : ''}`),
    saved
      ? `${plural(added.length)} added to this stage as "${schema.statuses?.find((s) => s.value === schema.lookup!.status)?.label ?? 'Retrieved'}", each with its DOI or link${added.length < works.length ? '; the rest were already listed or there was no room' : ''}.`
      : holds
        ? 'Nothing was added: these are already listed, or the list is full.'
        : 'Nothing was saved: this stage does not hold a list of works.',
    'These are the records the search returned. Nobody has read them: say what each established and how it bears on your question, and remove any that do not belong.',
  ];
  return done(key, {
    status: 'succeeded', toolsUsed: ['search'], params,
    changes: saved ? { version_ids: versionIds } : {},
    output: clip(lines.join('\n')),
  });
}

const withAnswer = (instruction: string, answer?: string) =>
  answer ? `${instruction}\nThe user was asked which takes priority and answered: "${answer}". Follow that.` : instruction;

export async function performStep(ctx: PerformContext): Promise<StepOutcome> {
  const key = ctx.step.action_key;
  const params = ctx.step.params ?? {};
  const inputs = inputsFrom(ctx.project);
  const model = ctx.project.model || undefined;

  // Sections already queued — after a reload, or by the user — are waited for
  // without a planner call and without spending a step.
  if (key === AWAIT_SECTIONS_STEP) {
    const ids = (ctx.facts?.manuscript?.pendingJobs ?? []).map((j) => j.payload?.section_id as string).filter(Boolean);
    return waitForSections(ctx, key, ids, 'Finished writing');
  }

  if (key === INTERPRET_STEP) {
    const run = ctx.interpret!;
    const res = await api.agentInterpretResult(
      {
        inputs, state: ctx.digest, sandbox_run_id: run.sandboxRunId, code: run.code,
        stdout: run.stdout, stderr: run.stderr, exit_code: run.exitCode, model,
      },
      ctx.signal
    );
    return done(key, {
      status: 'succeeded', output: clip(res.text), toolsUsed: ['model'],
      changes: { sandbox_run_id: run.sandboxRunId }, params: { ...params, sandbox_run_id: run.sandboxRunId },
      interpretedRunId: run.sandboxRunId,
    });
  }

  switch (actionFor(key)?.performer) {
    case 'reason': {
      const res = await api.agentReason({ inputs, state: ctx.digest, action_key: key, params, model }, ctx.signal);
      return done(key, { status: 'succeeded', output: clip(res.text), toolsUsed: ['model'], changes: {} });
    }

    case 'compute': {
      const kind = params.kind === 'simulation' ? 'simulation' : 'computation';
      // M3: on a written stage whose code the objective asks to check, the
      // run is that code, as written, against the named cases.
      const checking = ctx.template.key !== 'research' && !ctx.template.inquiry && ctx.facts?.code;
      const goal = checking
        ? checkGoal(ctx.facts!.code!, inputs.objective)
        : (typeof params.goal === 'string' ? params.goal : ctx.step.expected_outcome).slice(0, MAX_GOAL);
      const written = await api.agentWriteCode({ inputs, state: ctx.digest, goal, kind, model }, ctx.signal);
      let result;
      try {
        result = await api.runSandbox(
          { project_id: ctx.project.id, run_id: ctx.run.id, step_id: ctx.step.id, code: written.code, kind },
          ctx.signal
        );
      } catch (e) {
        const status = (e as { status?: number }).status;
        // A cap or allowance is a missing resource, not a broken step.
        if (status === 429) {
          return done(key, {
            status: 'blocked', blockKind: 'tool_missing', toolsUsed: ['model'],
            output: `${(e as Error).message}\n\nThe code was written but not run:\n\n\`\`\`python\n${written.code}\n\`\`\``,
            changes: {},
          });
        }
        throw e;
      }
      const { sandbox_run: run, classification } = result;
      const ran = run.exit_code !== null && !run.timed_out && (run.status === 'ok' || run.status === 'error');
      // What the code had to read is part of what happened (1 Oct, item 16:
      // "preserve the reason"): the files that were in /data, or that there
      // were none.
      const read = result.data_files ?? [];
      const output = [
        classification.summary,
        read.length
          ? `Data available to the code: ${read.map((f) => `${f.name} (${f.bytes.toLocaleString()} bytes)`).join(', ')}.`
          : 'No data files are attached to this project, so the code had none to read.',
        '```python\n' + written.code + '\n```',
        run.stdout ? 'Output:\n```\n' + run.stdout + '\n```' : '',
        run.stderr ? 'Errors:\n```\n' + run.stderr.slice(-1500) + '\n```' : '',
      ].filter(Boolean).join('\n\n');
      // A run that executed cleanly is execution truth, recorded without a
      // model: on the row it carried out, and as the figures it printed.
      const recorded = ran && classification.stepStatus === 'succeeded' && run.exit_code === 0
        ? await recordRun(ctx, params.row, { id: run.id, stdout: run.stdout })
        : classification.blockKind === 'data_missing'
          ? await recordBlockedRun(ctx, params.row, { runId: run.id, reason: classification.missing ?? classification.summary })
          : { changes: {}, notes: [] };
      return done(key, {
        status: classification.stepStatus,
        blockKind: classification.blockKind,
        output: clip([output, ...recorded.notes].join('\n\n')),
        toolsUsed: ['model', 'sandbox'],
        changes: { sandbox_run_id: run.id, ...recorded.changes },
        sandboxLabel: classification.executionLabel,
        followUp: ran && classification.stepStatus === 'succeeded'
          ? { sandboxRunId: run.id, code: written.code, stdout: run.stdout, stderr: run.stderr, exitCode: run.exit_code }
          : undefined,
      });
    }

    case 'literature': {
      // The works are the ones the project already names: the stage whose
      // rows can be looked up. On that stage the result is saved; from any
      // other stage it is reported, and that stage is left as it is.
      const holder = ctx.template.stages.find((s) => itemSchemaFor(s).lookup && parseItems(ctx.bundles[s.id]?.versions.at(-1)?.content)?.length);
      // No works are named yet, or the planner asked for more than the list
      // has: the index is searched by topic instead (2 Oct). This used to end
      // "There is no list of works to look up yet."
      const asked = typeof params.query === 'string' ? params.query.trim() : '';
      const schema = holder ? itemSchemaFor(holder) : null;
      const rows = holder ? parseItems(ctx.bundles[holder.id]!.versions.at(-1)!.content)! : [];
      // Asked for more, but the list already has the works its stage asks
      // for: a search would only add rows nobody chose (4 Oct, production).
      const enough = Boolean(holder && schema && enoughWorksFound(holder, rows, schema));
      if (!holder || !schema || (asked && !enough)) return searchLiterature(ctx, key, asked || inputs.objective);
      const works = lookupQueries(rows, schema);
      if (enough && !works.length) {
        return done(key, {
          status: 'succeeded', toolsUsed: [], changes: {},
          output: `No new search was run: ${holder.label} already lists the works it needs, found in OpenAlex. What is left is yours — say what each work established and how it bears on the question, and remove any that do not belong.`,
        });
      }
      // Found, then read: each found source's abstract is judged against its
      // row before anything is handed to the user (5 Oct).
      const checked = await lookupAndVerify(ctx.project, rows, schema, ctx.signal);
      if (!checked) return done(key, { status: 'failed', output: 'There is nothing named to look up yet.', toolsUsed: [], changes: {} });
      const result = checked.lookup;
      const lines = [
        checked.message,
        ...checked.items
          .filter((i) => works.some((w) => w.id === i.id) && (i[schema.lookup!.recordField] ?? '').trim())
          .map((i) => `- ${(i[schema.lookup!.recordField] ?? '').slice(0, 300)}`),
        ...works.filter((w) => !checked.items.find((i) => i.id === w.id && (i[schema.lookup!.recordField] ?? '').trim())).map((w) => `- Not found: ${w.work.slice(0, 160)}`),
      ];
      let versionIds: string[] = [];
      if (holder.id === ctx.stage.id && result.found && ctx.appendStageVersion) {
        const created = await ctx.appendStageVersion(holder.id, holder.label, {
          content: serializeItems(checked.items),
          source_operation: 'literature_lookup',
          instruction: ctx.step.rationale || 'Go mode looked the works up and read their abstracts.',
          model: checked.verify ? ctx.project.model : '',
          mode: ctx.project.mode,
          change_summary: `Looked up in OpenAlex: ${result.found} found, ${result.notFound} not found${checked.verify ? `; ${checked.verify.supported} AI verified from the abstract` : ''}.`,
        });
        const id = (created as { id?: unknown } | null)?.id;
        if (typeof id === 'string') versionIds = [id];
      }
      return done(key, {
        status: 'succeeded', toolsUsed: checked.verify ? ['search', 'model'] : ['search'], changes: versionIds.length ? { version_ids: versionIds } : {},
        output: clip(lines.join('\n')),
      });
    }

    case 'draft':
    case 'revise': {
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const head = ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content ?? '';
      const revising = actionFor(key)!.performer === 'revise';
      const instruction = typeof params.instruction === 'string' ? params.instruction : '';
      if (revising && instruction && !ctx.conflictAnswer) {
        const conflicts = await findInstructionConflicts({
          project: ctx.project, stageId: ctx.stage.id, instruction,
          headVersionId: ctx.bundles[ctx.stage.id]?.versions.at(-1)?.id ?? null,
          stage: { label: ctx.stage.label, instruction: ctx.stage.entry_prompt_hint },
        });
        if (conflicts.length) return askWhichTakesPriority(key, params, instruction, conflicts);
      }
      // The instruction used to reach only the version's metadata, never the
      // model: "revise" was "regenerate with the old draft as context" (B0).
      const res = await api.generateStageArtifact(
        generationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, ctx.stage, revising ? head : '', revising ? withDerivation(withAnswer(instruction, ctx.conflictAnswer), ctx.derived) : ''),
        ctx.signal
      );
      const generated = generationContent(ctx.stage, res);
      // A revised table keeps what a lookup, a run or the user established on
      // its rows: the model may not claim "Retrieved", so without this every
      // found work went back to "Suggested" (4 Oct, production).
      const before = revising && rendererHoldsItems(ctx.stage.renderer) ? parseItems(head) : null;
      const after = before ? parseItems(generated) : null;
      const content = before && after ? serializeItems(carryUserFields(before, after, itemSchemaFor(ctx.stage))) : generated;
      if (!content) {
        return done(key, { status: 'failed', output: 'The model returned nothing usable.', toolsUsed: ['model'], changes: {} });
      }
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content,
        source_operation: revising ? 'agent_revise' : 'agent_draft',
        base_content: head,
        instruction: instruction || ctx.step.rationale || ctx.stage.entry_prompt_hint || '',
        model: res.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: revising ? `Go mode: ${instruction || 'revised'}` : 'Go mode draft.',
        finish_reason: res.finish_reason || null,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        // What changed, so the record can be checked against the project (SN-25).
        changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
        output: `${revising ? 'Revised' : 'Drafted'} ${ctx.stage.label} — saved as a new version (${content.length.toLocaleString()} characters).`,
      });
    }

    case 'continue': {
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const head = ctx.bundles[ctx.stage.id]?.versions.at(-1);
      if (!head?.content.trim()) {
        return done(key, { status: 'failed', output: 'There is no draft to continue.', toolsUsed: [], changes: {} });
      }
      // The same call as the page's "Continue writing" (use-stage-tools).
      const { iteration } = await api.continueDocument(
        {
          inputs,
          incomplete_iteration: asIteration(head.content, head.version_number, ctx.project.mode),
          iteration_number: head.version_number + 1,
          model,
        },
        ctx.signal
      );
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content: iteration.output,
        source_operation: 'continuation',
        instruction: 'Continue from where the draft stopped.',
        model: iteration.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: iteration.summary || 'Go mode continued the draft from where it was cut off.',
        finish_reason: null,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
        output: `Continued ${ctx.stage.label} from where the draft was cut off — saved as a new version.`,
      });
    }

    case 'outline': {
      const f = ctx.facts?.outline;
      if (!f) return done(key, { status: 'failed', output: 'This stage does not hold an outline.', toolsUsed: [], changes: {} });
      if (f.namedSections > 0) {
        return done(key, { status: 'failed', output: 'There is already an outline; edit or regenerate it yourself.', toolsUsed: [], changes: {} });
      }
      // The same function "Generate the outline" calls (B2a), then committed
      // as a version straight away: something the user can approve or edit,
      // not a draft that exists only in this tab.
      // A derived outline (Research) is built from the stages already done,
      // by the same function the panel's own button calls; no model is asked.
      const derived = ctx.template.outline_stage === 'derived';
      const doc = await generateOutlineDraft({
        project: ctx.project, doc: f.doc, drafts: [],
        // In the form the project's reader calls for; the user can lay it out the other way on the outline.
        ...(derived ? { derive: () => deriveOutlineItems(ctx.template, ctx.state, ctx.bundles, { form: defaultOutlineForm(ctx.template, ctx.project) }) } : {}),
      });
      if (countNamedSections(doc) < 2) {
        return done(key, {
          status: 'failed', toolsUsed: [], changes: {},
          output: derived
            ? 'The earlier stages have not produced enough to build an outline from yet.'
            : 'The outline came back with fewer than two named sections; nothing usable to approve.',
        });
      }
      const created = await commitOutlineVersion(f.artifact, doc, {
        sourceOperation: 'agent_outline',
        instruction: ctx.step.rationale || 'Go mode generated the outline.',
        changeSummary: 'Go mode: generated the outline.',
        model: ctx.project.model,
        mode: ctx.project.mode,
      });
      ctx.refresh?.();
      const named = countNamedSections(parseOutlineDocument(created.content));
      if (named < 2) {
        return done(key, { status: 'failed', output: `The outline came back with ${named} named section(s); nothing usable to approve.`, toolsUsed: derived ? [] : ['model'], changes: { version_ids: [created.id] } });
      }
      return done(key, {
        status: 'succeeded', toolsUsed: derived ? [] : ['model'], changes: { version_ids: [created.id] },
        output: `${derived ? 'Built an outline from the stages already done:' : 'Generated an outline of'} ${named} sections, saved as version ${created.version_number}: ${parseOutlineDocument(created.content).items.map((i, n) => `${n + 1}. ${i.title}`).join('; ')}. Approve it to draft against it.`,
      });
    }

    case 'sections': {
      const m = ctx.facts?.manuscript;
      if (!m) return done(key, { status: 'failed', output: 'There is nothing to write sections into yet — the outline has not been approved.', toolsUsed: [], changes: {} });
      if (m.pendingJobs.length) return done(key, { status: 'failed', output: 'Sections are already being written; wait for them first.', toolsUsed: [], changes: {} });
      if (key === 'draft_sections') {
        if (!m.approvedOutlineVersionId) return done(key, { status: 'failed', output: 'No approved outline to draft against.', toolsUsed: [], changes: {} });
        const ids = await enqueueDraftJobs({
          project: ctx.project, artifactId: m.artifact.id, stageId: ctx.stage.id, outline: m.outline,
          approvedOutlineVersionId: m.approvedOutlineVersionId, jobs: m.jobs, stageHint: ctx.stage.entry_prompt_hint,
        });
        if (!ids.length) return done(key, { status: 'failed', output: 'Every section is already written.', toolsUsed: [], changes: {} });
        return waitForSections(ctx, key, ids, 'Wrote');
      }
      if (!m.brief) return done(key, { status: 'failed', output: 'This stage has no revision brief.', toolsUsed: [], changes: {} });
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const holderLabel = ctx.template.stages.find((s) => s.id === m.holderStageId)?.label ?? ctx.stage.label;
      const append = ctx.appendStageVersion;
      const ids = await enqueueRevisionJobs({
        project: ctx.project, artifactId: m.artifact.id, stageId: ctx.stage.id, outline: m.outline,
        approvedOutlineVersionId: m.approvedOutlineVersionId, brief: m.brief, stageHint: ctx.stage.entry_prompt_hint,
        saveSnapshot: (v) => append(m.holderStageId, holderLabel, v),
      });
      if (!ids.length) return done(key, { status: 'failed', output: 'No written section to revise.', toolsUsed: [], changes: {} });
      return waitForSections(ctx, key, ids, 'Revised');
    }

    case 'apply': {
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const head = ctx.bundles[ctx.stage.id]?.versions.at(-1);
      const findings = ctx.latestEvaluation?.findings ?? [];
      if (!head?.content.trim() || !findings.length) {
        return done(key, { status: 'failed', output: 'There are no findings on the current draft to apply.', toolsUsed: [], changes: {} });
      }
      if (!ctx.conflictAnswer) {
        const conflicts = await findInstructionConflicts({
          project: ctx.project, stageId: ctx.stage.id, instruction: findingsInstruction(findings), headVersionId: head.id,
          stage: { label: ctx.stage.label, instruction: ctx.stage.entry_prompt_hint },
        });
        if (conflicts.length) return askWhichTakesPriority(key, params, findings.map((f) => f.summary).join('; '), conflicts);
      }
      const rev = await reviseWithFindings({
        project: ctx.project, content: head.content,
        findings: ctx.conflictAnswer
          ? [...findings, { id: 'priority', category: 'Priority', summary: 'Which takes priority, as the user decided', suggested_change: ctx.conflictAnswer }]
          : findings,
        source: 'the stage check', signal: ctx.signal,
        // A table is revised as rows, by the generator that drafted it.
        ...(rendererHoldsItems(ctx.stage.renderer)
          ? { table: { stage: ctx.stage, request: (instruction: string) => generationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, ctx.stage, head.content, instruction) } }
          : {}),
      });
      // Go's own apply, told apart from the user's Apply button in the history.
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, { ...appliedFindingsVersion(rev, ctx.project), source_operation: 'agent_apply' });
      const versionId = (created as { id?: unknown } | null)?.id;
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
        output: `Applied ${findings.length} finding${findings.length === 1 ? '' : 's'} to ${ctx.stage.label} — saved as a new version.`,
      });
    }

    case 'triage': {
      const r = ctx.facts?.review;
      if (!r || !r.routine.length) return done(key, { status: 'failed', output: 'No routine finding is left to decide.', toolsUsed: [], changes: {} });
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const res = await api.agentTriage(
        {
          inputs, state: ctx.digest,
          items: r.routine.map((i) => Object.fromEntries(Object.entries(i).filter(([k, v]) => k !== 'status' && k !== 'reason' && typeof v === 'string')) as Record<string, string>),
          statuses: proposableStatuses(r.schema).map((s) => ({ value: s.value, label: s.label, requires_reason: Boolean(s.requiresReason) })),
          model,
        },
        ctx.signal
      );
      // Only the routine rows, only the table's own statuses, a reason where
      // one is demanded — anything else leaves the row for the user.
      const { items, applied } = applyTriage(r.items, res.decisions.filter((d) => r.routine.some((i) => i.id === d.id)), r.schema);
      if (!applied.length) return done(key, { status: 'failed', output: 'The model returned no usable decision.', toolsUsed: ['model'], changes: {} });
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content: serializeItems(items),
        source_operation: 'agent_triage',
        base_content: ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content ?? '',
        instruction: ctx.step.rationale || 'Go mode decided the routine findings.',
        model: res.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: `Go mode decided ${applied.length} routine finding${applied.length === 1 ? '' : 's'}; ${r.material.length} left for you.`,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      const decided = items.filter((i) => applied.includes(i.id)).map((i) => `${(r.schema.statuses ?? []).find((s) => s.value === i.status)?.label ?? i.status}: ${(i.finding ?? i.text ?? i.id).slice(0, 120)}`);
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        changes: { ...(typeof versionId === 'string' ? { version_ids: [versionId] } : {}), items_triaged: applied },
        output: `Decided ${applied.length} routine finding${applied.length === 1 ? '' : 's'}:\n${decided.map((d) => `- ${d}`).join('\n')}` +
          (r.material.length ? `\n\n${r.material.length} finding${r.material.length === 1 ? '' : 's'} would change the work and ${r.material.length === 1 ? 'is' : 'are'} left for you.` : ''),
      });
    }

    case 'propose': {
      const r = ctx.facts?.review;
      const asked = r ? proposeTargets(r.items, r.schema).length : 0;
      if (!r || !asked) return done(key, { status: 'failed', output: 'No row is left without a status or a proposal.', toolsUsed: [], changes: {} });
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const res = await proposeStatuses({ project: ctx.project, items: r.items, schema: r.schema, state: ctx.digest, signal: ctx.signal });
      if (!res.applied.length) return done(key, { status: 'failed', output: 'The rows do not say enough to tell their status; they are left for you.', toolsUsed: ['model'], changes: {} });
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content: serializeItems(res.items),
        source_operation: 'agent_triage',
        base_content: ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content ?? '',
        instruction: ctx.step.rationale || 'Go mode proposed a status for each row from its own text.',
        model: res.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: `Go mode proposed a status for ${res.applied.length} row${res.applied.length === 1 ? '' : 's'}; they count once you confirm them.`,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      const lines = res.items.filter((i) => res.applied.includes(i.id)).map((i) => `${(r.schema.statuses ?? []).find((s) => s.value === i.status)?.label ?? i.status}: ${i.reason}`);
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        changes: { ...(typeof versionId === 'string' ? { version_ids: [versionId] } : {}) },
        output: `Proposed a status for ${res.applied.length} of ${asked} row${asked === 1 ? '' : 's'}, from what each row says. They count once you confirm them:\n${lines.map((l) => `- ${l}`).join('\n')}`,
      });
    }

    case 'recheck': {
      // 6 Oct: a stage a change reopened is repaired, not left recommending
      // what the change superseded. The project's current facts and brief
      // ride on the request (inputsFrom); the instruction says what changed
      // and what to keep.
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const target = ctx.template.stages.find((s) => s.id === String(params.stage_id ?? ''));
      const st = target ? ctx.state.stages[target.id] : undefined;
      if (!target || st?.status !== 'stale') {
        return done(key, { status: 'failed', output: 'That stage is not waiting for a recheck.', toolsUsed: [], changes: {} });
      }
      const headVersion = ctx.bundles[target.id]?.versions.at(-1);
      const head = headVersion?.content ?? '';
      const why = st.stale?.reason ?? 'something it relied on changed';
      const superseded = supersededFactValues(ctx.project.facts);
      const before = rendererHoldsItems(target.renderer) ? parseItems(head) : null;
      const instruction = recheckInstruction(target.label, why, superseded, Boolean(before));
      const attempt = async (text: string) => {
        const res = await api.generateStageArtifact(
          generationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, target, head, text),
          ctx.signal
        );
        const generated = generationContent(target, res);
        const after = before ? withoutRevisionNotes(parseItems(generated)) : null;
        const content = before && after ? serializeItems(carryUserFields(before, after, itemSchemaFor(target))) : generated;
        return { res, content };
      };
      let { res, content } = await attempt(instruction);
      // A repair that still states a value the user changed is not a repair
      // (Sean, 7 Oct: "the final announcement still displayed November 12 and
      // $12"). Checked in code; one more try names what was left behind.
      let leftover = content ? leftoverValues(content, superseded) : [];
      if (content && leftover.length) {
        ({ res, content } = await attempt(
          `${instruction} YOUR PREVIOUS ATTEMPT STILL STATED: ${leftover.map(describeValue).join(', ')}. Replace each with the current fact's value.`
        ));
        leftover = content ? leftoverValues(content, superseded) : [];
      }
      if (!content) {
        return done(key, { status: 'failed', output: 'The model returned nothing usable.', toolsUsed: ['model'], changes: {} });
      }
      const created = await ctx.appendStageVersion(target.id, target.label, {
        content,
        source_operation: 'agent_revise',
        base_content: head,
        instruction,
        model: res.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: `Repaired after a change: ${why}`,
        finish_reason: res.finish_reason || null,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      // Closed again only when its own requirements hold; a reserved approval
      // stays the user's, and the stage stays reopened until they give it.
      const evaluation = evaluateStage(ctx.template, target.id, ctx.context);
      const actor = stageMoveActor(ctx.run.policy, ctx.approvedByUser);
      if (leftover.length) {
        const named = leftover.map((v) => `${describeValue(v)} (now: "${v.now}")`).join('; ');
        return done(key, {
          status: 'failed', toolsUsed: ['model'],
          changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
          output: `Couldn't finish repairing ${target.label}: the new version still states ${named}. It is saved, so you can see it, and the stage stays reopened; edit those values or ask Go to try again.`,
        });
      }
      if (evaluation.canAdvance && typeof versionId === 'string') {
        if (ctx.setStageSummary) {
          const summary = summariseStageContent(target, content);
          if (summary) await ctx.setStageSummary(target.id, summary).catch(() => undefined);
        }
        await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
          type: 'stage_marked_complete',
          stage_id: target.id,
          actor,
          agent_run_id: actor === 'system' ? ctx.run.id : null,
          reason: `Repaired after a change: ${why}`,
          payload: {
            evidence_version_id: versionId,
            repaired_after: why,
            ...(actor === 'user' && ctx.approvedByUser ? { via: 'go_approve' } : {}),
          },
        });
        await ctx.afterStageEvent();
      }
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'],
        changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
        output: evaluation.canAdvance
          ? `Repaired ${target.label} (${why}) — saved as a new version and marked complete again; the earlier version is kept.`
          : `Repaired ${target.label} (${why}) — saved as a new version; it stays reopened until: ${evaluation.unmet.filter((c) => c.blocking).map((c) => c.label).join('; ')}.`,
      });
    }

    case 'facts': {
      // 7 Oct (L-51): what the attached documents state becomes accepted
      // facts, each quoted from its file — under the routine-decision policy,
      // which the database checks; nothing inferred, nothing computed.
      const docs = attachedDocuments(ctx.project.context).filter(
        (d) => !currentFacts(ctx.project.facts).some((f) => f.source_kind === 'file' && f.source_ref?.name === d.name)
      );
      if (!docs.length) return done(key, { status: 'failed', output: 'No attached document is waiting for its facts.', toolsUsed: [], changes: {} });
      const res = await api.agentExtractFacts(
        { inputs: inputsFrom(ctx.project), sources: docs.map((d) => ({ id: d.name, label: d.name, text: d.text })), model: ctx.project.model },
        ctx.signal
      );
      const recorded = await recordPolicyFacts(
        ctx.project, ctx.run.id,
        res.facts.map((f) => ({ statement: f.statement, subject: f.subject, kind: f.kind, file: f.source_id, quote: f.quote }))
      );
      await ctx.refresh?.();
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'], changes: {},
        output: recorded.length
          ? `Recorded ${recorded.length} fact${recorded.length === 1 ? '' : 's'} from ${docs.map((d) => d.name).join(', ')} under your routine-decision policy, each quoted from its file:\n${recorded.map((f) => `- ${f.statement}`).join('\n')}`
          : `Read ${docs.map((d) => d.name).join(', ')}; it states no fact that is not already on record.`,
      });
    }

    case 'confirm': {
      // 6 Oct: under "handle them for me", proposals that stand as they are
      // are confirmed by Go, and say so — not three row decisions for the user.
      const r = ctx.facts?.review;
      if (!r) return done(key, { status: 'failed', output: 'This stage has no rows to confirm.', toolsUsed: [], changes: {} });
      if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
      const ok = new Set(confirmableProposals(r.items, r.schema).map((i) => i.id));
      if (!ok.size) return done(key, { status: 'failed', output: 'No proposal can stand as it is; they are left for you.', toolsUsed: [], changes: {} });
      const items = r.items.map((i) => (ok.has(i.id) ? { ...i, status_source: 'policy' } : i));
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content: serializeItems(items),
        source_operation: 'agent_triage',
        base_content: ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content ?? '',
        instruction: 'Confirmed the proposed statuses under the routine-decision policy.',
        model: ctx.project.model,
        mode: ctx.project.mode,
        change_summary: `Go mode confirmed ${ok.size} proposed status${ok.size === 1 ? '' : 'es'} under your routine-decision policy.`,
      });
      const versionId = (created as { id?: unknown } | null)?.id;
      return done(key, {
        status: 'succeeded', toolsUsed: [],
        changes: typeof versionId === 'string' ? { version_ids: [versionId] } : {},
        output: `Confirmed ${ok.size} proposed status${ok.size === 1 ? '' : 'es'} under your routine-decision policy. Each says so on its row; change any of them.`,
      });
    }

    case 'evaluate': {
      const version = ctx.bundles[ctx.stage.id]?.versions.at(-1);
      if (!version?.content.trim()) {
        return done(key, { status: 'failed', output: 'There is no draft to check yet.', toolsUsed: [], changes: {} });
      }
      if (!ctx.recordStageEvaluation) throw new Error('This view cannot save evaluations.');
      const res = await api.evaluateStageArtifact(
        evaluationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, ctx.stage, version.content, ctx.approvedOutline),
        ctx.signal
      );
      await ctx.recordStageEvaluation(
        ctx.stage.id, version.id,
        evaluationRecord(res, ctx.project.model, 'manual', figureFindings(version.content, figureSources(ctx.project, ctx.bundles, ctx.stage.id)))
      );
      const e = res.evaluation;
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'], changes: { version_ids: [version.id] },
        output: `Alignment ${e.alignment.score} · Clarity ${e.clarity.score} · Drift ${e.drift.score}` +
          (e.findings?.length ? ` · ${e.findings.length} finding(s)` : '') +
          (e.interpretation?.bullets.length ? `\n\n${e.interpretation.label}:\n${e.interpretation.bullets.map((l) => `- ${l}`).join('\n')}` : ''),
      });
    }

    case 'commit': {
      // A routine approval under "Routine decisions: handle them for me"
      // (Sean, 5 Oct). Validation first — delegation satisfies authority, it
      // never bypasses a failed check — then the commit, which the database
      // refuses unless the project's policy is 'handle' at that moment and the
      // pinned template marks the approval delegable.
      const id = typeof params.criterion_id === 'string' ? params.criterion_id : '';
      const criterion = ctx.stage.exit_criteria.find((c) => c.id === id);
      if (!criterion || criterion.check !== 'manual' || criterion.authority !== 'delegable') {
        return done(key, { status: 'failed', output: `That approval is not a routine one; it is yours to give.`, toolsUsed: [], changes: {} });
      }
      if (ctx.project.routine_decisions !== 'handle') {
        return done(key, { status: 'failed', output: `Your routine decisions are set to "Ask me", so "${criterion.label}" waits for you.`, toolsUsed: [], changes: {} });
      }
      const head = ctx.bundles[ctx.stage.id]?.versions.at(-1);
      if (!head?.content.trim()) {
        return done(key, { status: 'failed', output: `There is nothing on ${ctx.stage.label} to check "${criterion.label}" against yet.`, toolsUsed: [], changes: {} });
      }
      const check = await api.agentCheckCriterion(
        { inputs: inputsFrom(ctx.project), stage_label: ctx.stage.label, criterion: criterion.label, content: head.content, model: ctx.project.model },
        ctx.signal
      );
      if (!check.met) {
        return done(key, {
          status: 'failed', toolsUsed: ['model'], changes: {},
          output: `Checked "${criterion.label}" on version ${head.version_number}: not met — ${check.reason} I will revise toward it rather than ask you; it is committed only once it holds.`,
        });
      }
      if (!ctx.commitCriterion) throw new Error('This view cannot record approvals.');
      await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
        type: 'criterion_committed',
        stage_id: ctx.stage.id,
        actor: 'system',
        agent_run_id: ctx.run.id,
        reason: check.reason,
        payload: { criterion_id: criterion.id, policy: 'routine_decisions', evidence_version_id: head.id },
      });
      await ctx.commitCriterion(ctx.stage.id, criterion.id);
      await ctx.afterStageEvent();
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'], changes: { event_types: ['criterion_committed'] },
        output: `"${criterion.label}": checked against version ${head.version_number} — ${check.reason} Committed under your routine-decision policy.`,
      });
    }

    case 'advance': {
      const target = ctx.stage.transitions.default_next;
      const evaluation = evaluateStage(ctx.template, ctx.stage.id, ctx.context);
      // Sean, 7 Oct (TaskBoard): Output was marked complete while its own
      // check said "incomplete" and "needs realignment", and Realign was then
      // skipped. A run does not close a draft its latest check failed; it
      // revises first. The user's own Approve still can.
      const verdict = checkVerdict(ctx);
      if (verdict && stageMoveActor(ctx.run.policy, ctx.approvedByUser) === 'system') {
        return done(key, {
          status: 'failed', toolsUsed: [], changes: {},
          output: `Not moving on: the latest check of ${ctx.stage.label} says ${verdict}. It needs a revision first.`,
        });
      }
      // The same evidence the transition bar records (A2): the head version,
      // or a snapshot of a finished manuscript saved now. Drafting used to
      // have neither, so Go always left it open.
      const evidence = evaluation.canAdvance
        ? await stageEvidence({
            template: ctx.template, stage: ctx.stage, bundles: ctx.bundles, project: ctx.project,
            appendStageVersion: ctx.appendStageVersion,
          })
        : undefined;
      const actor = stageMoveActor(ctx.run.policy, ctx.approvedByUser);
      // Complete when the requirements are met — with evidence when the stage
      // has any, and without it when the user approved the move, exactly as
      // the transition bar does. Only an autonomous run must cite a version
      // (20260928000000), so on a stage with no artifact, such as Outline
      // approval, it moves on and leaves the stage open. Otherwise move on
      // and leave the stage open, as "Continue anyway" does.
      // A stage with no artifact at all (Outline approval) has nothing to cite;
      // the database lets an autonomous run complete it on that ground
      // (20261004000000), so it no longer stays "open" after every Go run.
      const noArtifact = !ctx.bundles[ctx.stage.id]?.artifact;
      const type = evaluation.canAdvance && (evidence || actor === 'user' || noArtifact) ? 'stage_marked_complete' : 'stage_advanced';
      if (ctx.setStageSummary) {
        const summary = summariseStageContent(ctx.stage, stageContentForSummary(ctx.template, ctx.stage, ctx.bundles));
        if (summary) await ctx.setStageSummary(ctx.stage.id, summary).catch(() => undefined);
      }
      // The figures the stage established, for later stages to quote.
      if (type === 'stage_marked_complete' && ctx.setStageFigures) {
        const figures = await readStageFigures(ctx.project, ctx.stage, ctx.bundles[ctx.stage.id]?.versions.at(-1), ctx.bundles[ctx.stage.id]?.artifact?.key_figures);
        if (figures) await ctx.setStageFigures(ctx.stage.id, figures).catch(() => undefined);
      }
      await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
        type,
        stage_id: ctx.stage.id,
        to_stage_id: target ?? undefined,
        actor,
        agent_run_id: actor === 'system' ? ctx.run.id : null,
        reason: ctx.step.rationale || undefined,
        // The user's Approve on Go's proposal is recorded as theirs, and as
        // given through Go — not as a click on the stage (5 Oct, history).
        payload: {
          ...(type === 'stage_marked_complete' && evidence ? { evidence_version_id: evidence } : {}),
          ...(type === 'stage_advanced' && ctx.bundles[ctx.stage.id]?.versions.at(-1)
            ? { left_version_id: ctx.bundles[ctx.stage.id]!.versions.at(-1)!.id }
            : {}),
          ...(actor === 'user' && ctx.approvedByUser ? { via: 'go_approve' } : {}),
        },
      });
      await ctx.afterStageEvent();
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: { event_types: [type] },
        output: type === 'stage_marked_complete'
          ? `Marked ${ctx.stage.label} complete and moved on.`
          : `Moved on from ${ctx.stage.label}, leaving it open: ${evaluation.unmet.map((c) => c.label).join('; ') || 'requirements not met'}.`,
      });
    }

    case 'loop': {
      // A proposal, as with skipping: going back is the user's decision (the
      // database records a return only as theirs), so each round is a check-in.
      const to = ctx.stage.transitions.loop_to;
      if (!to) return done(key, { status: 'failed', toolsUsed: [], changes: {}, output: 'This stage does not start another round.' });
      const reason = (typeof params.reason === 'string' && params.reason.trim()) || ctx.step.rationale || 'The question this round ended on is worth pursuing.';
      // 7 Oct (Sean, 6 Oct, email 10: "continue justified investigation
      // within available tools and delegated authority"): an authorized
      // autonomous run whose routine decisions are Go's starts the round
      // itself, along the template's own loop; the database checks all three.
      if (ctx.run.policy === 'autonomous' && ctx.project.routine_decisions === 'handle') {
        // 7 Oct (L-54): before another round, is the objective already met —
        // or blocked on something no round can produce? Judged on this round's
        // work, the same check as at the end, and recorded.
        const roundText = roundContent(ctx, to);
        const verdict = await judgeObjective(ctx, `the round that ended at ${ctx.stage.label}`, roundText);
        if (verdict.outcome === 'met') {
          const target = ctx.stage.transitions.default_next;
          const head = ctx.bundles[ctx.stage.id]?.versions.at(-1);
          if (target && head) {
            await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
              type: 'stage_marked_complete',
              stage_id: ctx.stage.id,
              to_stage_id: target,
              actor: 'system',
              agent_run_id: ctx.run.id,
              reason: `Objective met in this round: "${verdict.basis_quote}"`,
              payload: { evidence_version_id: head.id, objective_met: true },
            });
            await ctx.afterStageEvent();
          }
          return done(key, {
            status: 'succeeded', toolsUsed: ['model'], changes: { event_types: ['objective_assessed', 'stage_marked_complete'] },
            output: `The objective is met in this round ("${verdict.basis_quote}"), so no further round: moving on to the write-up.`,
          });
        }
        if (verdict.blockers.length) {
          const line = pausedLine(verdict);
          return done(key, {
            status: 'succeeded', toolsUsed: ['model'], changes: { event_types: ['objective_assessed'] },
            output: `${line} Another round cannot produce it, so none was started.`,
            stop: { status: 'blocked', reason: line },
          });
        }
        await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
          type: 'stage_returned',
          stage_id: ctx.stage.id,
          to_stage_id: to,
          actor: 'system',
          agent_run_id: ctx.run.id,
          reason: `Next round: ${reason}`,
          payload: { next_round: true, policy: 'routine_decisions' },
        });
        await ctx.afterStageEvent();
        return done(key, {
          status: 'succeeded', toolsUsed: [], changes: { event_types: ['stage_returned'] },
          output: `Started the next round under your routine-decision policy: ${reason}`,
        });
      }
      const need: NeedsUser = { kind: 'next_round', stageId: ctx.stage.id, toStageId: to, reason };
      const message = `Suggested another round: ${reason}`;
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: {}, output: message,
        stop: { status: 'awaiting_decision', reason: message }, needs: need,
      });
    }

    case 'skip': {
      // A proposal, never a skip: the stage is skipped only if the user
      // presses the card's button, and that event is theirs.
      const reason = (typeof params.reason === 'string' && params.reason.trim()) || ctx.step.rationale || 'It is not the best next move for this objective.';
      const need: NeedsUser = { kind: 'skip_stage', stageId: ctx.stage.id, reason };
      const message = `Suggested skipping ${ctx.stage.label} for now: ${reason}`;
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: {}, output: message,
        stop: { status: 'awaiting_decision', reason: message }, needs: need,
      });
    }

    case 'block': {
      const kind = (['tool_missing', 'data_missing', 'needs_decision'] as const).find((k) => k === params.block_kind) ?? 'needs_decision';
      const reason = (typeof params.reason === 'string' && params.reason.trim()) || ctx.step.rationale || 'Go mode could not continue.';
      const actor = ctx.approvedByUser || ctx.run.policy === 'guided' ? 'user' : 'system';
      // What the stage has to work with now goes on the record with the
      // block, so the card can later say whether anything changed (2 Oct, item 9).
      const inputs = stageInputs(ctx.project, ctx.bundles[ctx.stage.id]?.versions.at(-1)?.id);
      // Marked stuck again, for the same kind of thing, with nothing changed
      // since it was last cleared: that was a retry, not progress. It is said
      // in those words and costs no step.
      const last = ctx.state.stages[ctx.stage.id]?.last_block;
      const repeat = last?.kind === kind && inputsChanged(last.inputs, inputs)?.changed === false;
      await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
        type: 'stage_blocked',
        stage_id: ctx.stage.id,
        actor,
        agent_run_id: actor === 'system' ? ctx.run.id : null,
        reason,
        payload: { block_kind: kind, inputs_at_block: inputs },
      });
      await ctx.afterStageEvent();
      const said = repeat ? `Nothing has changed since this stage was last marked stuck, so it stops at the same place: ${reason}` : reason;
      return done(key, {
        status: 'blocked', blockKind: kind, toolsUsed: [], changes: { event_types: ['stage_blocked'] },
        output: `Could not continue: ${said}`, stop: { status: 'blocked', reason: said },
        // The card with its options, at once: it used to take a second press of Resume to appear.
        needs: { kind: 'unblock_stage', stageId: ctx.stage.id, reason, blockKind: kind },
        ...(repeat ? { free: true } : {}),
      });
    }

    case 'ask': {
      // A button the planner names is checked against the page's own list;
      // one that is really there is pointed to in fixed words, so the user is
      // never sent looking for a control that does not exist (2 Oct, item 10).
      const named = (ctx.digest.controls ?? []).find(
        (c) => typeof params.control === 'string' && c.label.toLowerCase() === params.control.trim().toLowerCase()
      );
      const pointer = named ? `\n\nThe button is "${named.label}", ${named.where}.` : '';
      const question = `${ctx.step.decision_question || 'Which way should this go?'}${pointer}`;
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: {},
        output: question,
        stop: { status: 'awaiting_decision', reason: question },
        needs: { kind: 'answer_question', question },
      });
    }

    case 'complete': {
      // 6 Oct: "Objective met" while Summary still needed a recheck and a
      // finding was unresolved. Work open on any stage — other than this
      // stage's own approval, handled below — means the objective is not done.
      // Optional rows (a table that says it does not block finishing) do not
      // hold it up (C3, 8 Oct); a row carried forward that says a requirement
      // is unmet does (C2).
      const open = outstandingWork(ctx.template, ctx.state, ctx.context).filter(
        (i) => !(i.kind === 'unmet_blocking' && i.stageId === ctx.stage.id) && blocksCompletion(i)
      );
      if (ctx.deliverableDone && open.length > 0) {
        const list = open.map(describeOutstanding).join('; ');
        const reason = `The deliverable is written, but the work is not finished: ${list}.`;
        return done(key, {
          status: 'succeeded', toolsUsed: [], changes: {},
          output: `${reason} I will not call the objective met while any of it is open.`,
          stop: { status: 'awaiting_decision', reason },
        });
      }
      // PM-25: the model's opinion is not enough — the deliverable has to exist.
      // 7 Oct: nor is the deliverable existing. A research log that says the
      // criterion is not met is a deliverable (email 13); whether the
      // objective is met is judged, quoted, and recorded.
      if (ctx.deliverableDone) {
        const holder = deliverableStage(ctx.template);
        const content = holder ? deliverableText(ctx, holder.id) : '';
        const assessment = await judgeObjective(ctx, holder?.label ?? 'the deliverable', content);
        if (assessment.outcome === 'met') {
          return done(key, {
            status: 'succeeded', toolsUsed: [], changes: {},
            output: `The objective is met: "${assessment.basis_quote}". Nothing needs another pass.`,
            stop: { status: 'completed', reason: 'Objective met.' },
          });
        }
        // Not met: the cycle is finished, the objective is not. With a named
        // blocker the run is blocked on it; otherwise it is the user's call.
        const performed = assessment.performed.length ? ` Done: ${assessment.performed.join('; ')}.` : ' No computation or investigation was recorded as performed.';
        const proposed = assessment.proposed_next.length ? ` Proposed, not done: ${assessment.proposed_next.join('; ')}.` : '';
        const line = pausedLine(assessment);
        return done(key, {
          status: 'succeeded', toolsUsed: [], changes: {},
          output: `${line} ${assessment.reason}${performed}${proposed}`,
          stop: { status: assessment.blockers.length ? 'blocked' : 'awaiting_decision', reason: line },
        });
      }
      // What the planner usually means by it mid-project is "nothing more for
      // me on this stage". When the stage is only waiting for the user's
      // approval, say that, with the button: on production an Autonomous run
      // reached Analysis, could not move past its one required approval, and
      // "declared the objective complete" twice instead of asking for it.
      const waiting = evaluateStage(ctx.template, ctx.stage.id, ctx.context).unmet.filter((c) => c.blocking);
      if (waiting.length > 0 && waiting.every((c) => c.manual)) {
        const c = waiting[0];
        const reason = `${ctx.stage.label} has nothing left that I can do by myself. It is waiting for your approval: "${c.label}".`;
        return done(key, {
          status: 'succeeded', toolsUsed: [], changes: {}, output: reason,
          stop: { status: 'awaiting_decision', reason },
          needs: { kind: 'tick_criterion', stageId: ctx.stage.id, criterionId: c.id, label: c.label, ...(c.hint ? { hint: c.hint } : {}) },
        });
      }
      return done(key, {
            status: 'succeeded', toolsUsed: [], changes: {},
            output: 'The model judged the objective met, but the deliverable is not done yet, so the run stops here for you to decide.',
            stop: { status: 'awaiting_decision', reason: 'The model thinks the work is done, but the deliverable is not. Your call.' },
          });
    }

    default:
      return done(key, { status: 'failed', output: `Unknown action "${key}".`, toolsUsed: [], changes: {} });
  }
}

/** The deliverable as text, for the objective check: the manuscript for a long-form stage, else the head version. */
function deliverableText(ctx: Pick<PerformContext, 'bundles' | 'template'>, stageId: string): string {
  const bundle = ctx.bundles[stageId];
  const stage = ctx.template.stages.find((s) => s.id === stageId);
  if (stage?.renderer === 'long_form') {
    return (bundle?.artifact?.long_form?.outline ?? [])
      .map((sec) => `## ${sec.title}\n\n${sec.content ?? ''}`)
      .join('\n\n');
  }
  return bundle?.versions.at(-1)?.content ?? '';
}

/** Rows that are a revision note ("What changed: …") rather than one of the stage's items. */
export function withoutRevisionNotes<T extends Record<string, unknown>>(items: T[] | null): T[] | null {
  if (!items) return items;
  return items.filter((item) => !Object.values(item).some((v) => typeof v === 'string' && /^\s*\**\s*What changed\s*:/i.test(v)));
}

/**
 * What a repair is told (6 Oct, Sean's acceptance criteria: "Valid figures
 * and calculations remain intact. Superseded recommendations are repaired
 * consistently"). The current facts and brief reach the model with the request.
 */
export function recheckInstruction(stageLabel: string, why: string, superseded: readonly SupersededValue[] = [], table = false): string {
  // The values the user's fact changes made untrue, each with what replaces
  // it. Until 8 Oct the brief named the old sentence but not the new value,
  // and "keep every figure that still holds" kept November 12 (TeamNotes).
  const changes = [...new Map(superseded.map((v) => [`${v.kind}:${v.value}`, v])).values()];
  const replace = changes.length
    ? ' CHANGED FACTS — these values are no longer true; replace every occurrence, in every form it is written, with the current fact: ' +
      changes.map((v) => `${describeValue(v)} (was: "${v.was}"; now: "${v.now}")`).join('; ') + '.'
    : '';
  return (
    `RECHECK AFTER A CHANGE. ${stageLabel} was reopened because: ${why}. ` +
    'Bring it into line with the project as it now stands — the brief, the accepted facts and requirements, and the earlier stages. ' +
    'Keep every figure, calculation and finding that still holds, exactly as written. ' +
    'Replace any conclusion or recommendation the change superseded, and re-test each option against the requirements as they are now: one that no longer qualifies is said to be excluded, and why. ' +
    // A table has no place for a note: on a production replay (9 Oct) the line
    // became the Experiment table's first "run", marked worked by hand.
    (table
      ? 'This is a table: put no note in it. Every row stays one of the stage\'s own items; say what changed only in the rows it concerns.'
      : 'Begin with one line, "What changed:", saying what was kept and what was replaced.') +
    replace
  );
}

/**
 * Judge whether the objective is met by the given text, record the judgment as
 * `objective_assessed`, and return it (6–7 Oct). Used at the end of the work
 * and at the end of each round of ongoing work.
 */
async function judgeObjective(ctx: PerformContext, label: string, content: string) {
  const assessment = await api.agentAssessObjective(
    {
      inputs: inputsFrom(ctx.project),
      deliverable_label: label,
      content: content || '(empty)',
      steps: ctx.digest.recent_steps.map((s) => ({ action_key: s.action_key, execution_label: s.execution_label, output: s.output })),
      // The criterion the workflow was designed against, kept from the objective (7 Oct).
      success_criterion: ctx.template.execution?.success_criterion ?? '',
      failed_checks: failedChecks(ctx),
      model: ctx.project.model,
    },
    ctx.signal
  );
  const payload = {
    outcome: assessment.outcome, reason: assessment.reason, basis_quote: assessment.basis_quote,
    blockers: assessment.blockers, performed: assessment.performed, proposed_next: assessment.proposed_next,
  };
  await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
    type: 'objective_assessed',
    stage_id: ctx.stage.id,
    actor: 'system',
    agent_run_id: ctx.run.id,
    reason: assessment.reason,
    payload,
  });
  await ctx.afterStageEvent();
  return assessment;
}

/** This round's work as one text: every stage from where the round starts to the one that closes it. */
function roundContent(ctx: Pick<PerformContext, 'bundles' | 'template' | 'stage'>, fromStageId: string): string {
  const ids = ctx.template.stages.map((s) => s.id);
  const start = ids.indexOf(fromStageId);
  const end = ids.indexOf(ctx.stage.id);
  return ctx.template.stages
    .slice(Math.max(0, start), end + 1)
    .map((s) => `## ${s.label}\n\n${deliverableText(ctx, s.id)}`)
    .join('\n\n');
}

/**
 * What the latest check of the current draft says is wrong with it, in words,
 * or null: "incomplete" or "it needs realigning to the objective". Only a
 * check of the head version counts — one about an earlier draft says nothing
 * about this one.
 */
export function checkVerdict(ctx: Pick<PerformContext, 'latestEvaluation' | 'bundles' | 'stage'>): string | null {
  const e = ctx.latestEvaluation;
  const head = ctx.bundles[ctx.stage.id]?.versions.at(-1);
  if (!e || !head || e.version_id !== head.id) return null;
  const said: string[] = [];
  if ((e.completeness_status ?? '').toLowerCase() === 'incomplete') said.push(`it is incomplete${e.completeness_reason ? ` (${e.completeness_reason.trim().replace(/\.$/, '')})` : ''}`);
  if (e.needs_realignment) said.push('it needs realigning to the objective');
  return said.length ? said.join(', and ') : null;
}

/**
 * A revision that follows a derivation carries it, so the worked result
 * reaches the saved document (C4, 8 Oct) instead of staying in the run.
 */
export function withDerivation(instruction: string, derived?: { label: string; output: string }): string {
  if (!derived) return instruction;
  return `${instruction}\n\nAPPLY THIS WORK TO THE DOCUMENT. The "${derived.label}" step produced the result below; put it into this stage's text in full where it belongs — every step, equation and check — replacing what it corrects. Do not summarise it.\n--- BEGIN ${derived.label.toUpperCase()} RESULT ---\n${derived.output.slice(0, 20_000)}\n--- END ${derived.label.toUpperCase()} RESULT ---`.trim();
}

/**
 * What the project's own checks hold as still unmet, for the objective check
 * (C2): measured requirements that fail, and review rows carried forward that
 * say a requirement is unmet. The check may not call the objective met over them.
 */
export function failedChecks(ctx: Pick<PerformContext, 'context' | 'template'>): string[] {
  const label = (id: string) => ctx.template.stages.find((s) => s.id === id)?.label ?? id;
  const measured = Object.entries(ctx.context.measured ?? {}).flatMap(([id, ms]) =>
    ms.filter((m) => !m.satisfied).map((m) => `${label(id)}: ${m.label} — measured ${m.detail ?? 'not met'}`)
  );
  const carried = Object.entries(ctx.context.carriedForward ?? {}).flatMap(([id, rows]) =>
    rows.map((r) => `${label(id)}: carried forward unresolved — ${r}`)
  );
  return [...measured, ...carried].slice(0, 30);
}
