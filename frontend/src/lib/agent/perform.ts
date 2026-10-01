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
import { appliedFindingsVersion, findingsInstruction, reviseWithFindings } from '@/lib/workflow/apply-findings';
import { findInstructionConflicts } from '@/lib/workflow/conflict-trail';
import { describeWith, type InstructionConflict } from '@/lib/workflow/instruction-conflicts';
import { deriveOutlineItems } from '@/lib/workflow/derived-outline';
import { rendererHoldsItems, serializeItems } from '@/lib/workflow/stage-artifact';
import { applyTriage } from '@/lib/workflow/triage';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { summariseStageContent } from '@/lib/workflow/digest';
import { stageContentForSummary, stageEvidence } from '@/lib/workflow/evidence';
import { evaluateStage } from '@/lib/workflow/engine';
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
  /** Re-read the project after a write that the store did not make itself. */
  refresh?: () => unknown;
  /** Live progress for a long step ("2 of 5 sections written"). */
  onProgress?: (text: string) => void;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  recordStageEvaluation?: (stageId: string, versionId: string, evaluation: NewEvaluation) => Promise<Evaluation>;
  setStageSummary?: (stageId: string, summary: string) => Promise<void>;
  /** Re-read the event log (and move the cursor) after a stage event. */
  afterStageEvent: () => Promise<void>;
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
      const goal = (typeof params.goal === 'string' ? params.goal : ctx.step.expected_outcome).slice(0, MAX_GOAL);
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
      return done(key, {
        status: classification.stepStatus,
        blockKind: classification.blockKind,
        output: clip(output),
        toolsUsed: ['model', 'sandbox'],
        changes: { sandbox_run_id: run.id },
        sandboxLabel: classification.executionLabel,
        followUp: ran && classification.stepStatus === 'succeeded'
          ? { sandboxRunId: run.id, code: written.code, stdout: run.stdout, stderr: run.stderr, exitCode: run.exit_code }
          : undefined,
      });
    }

    case 'literature':
      return done(key, {
        status: 'blocked', blockKind: 'tool_missing', toolsUsed: [], changes: {},
        output: 'Checking the literature needs a search tool, and none is connected yet. Nothing was looked up.',
      });

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
        });
        if (conflicts.length) return askWhichTakesPriority(key, params, instruction, conflicts);
      }
      // The instruction used to reach only the version's metadata, never the
      // model: "revise" was "regenerate with the old draft as context" (B0).
      const res = await api.generateStageArtifact(
        generationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, ctx.stage, revising ? head : '', revising ? withAnswer(instruction, ctx.conflictAnswer) : ''),
        ctx.signal
      );
      const content = generationContent(ctx.stage, res);
      if (!content) {
        return done(key, { status: 'failed', output: 'The model returned nothing usable.', toolsUsed: ['model'], changes: {} });
      }
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content,
        source_operation: revising ? 'agent_revise' : 'agent_draft',
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
        ...(derived ? { derive: () => deriveOutlineItems(ctx.template, ctx.state, ctx.bundles) } : {}),
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
          approvedOutlineVersionId: m.approvedOutlineVersionId, jobs: m.jobs,
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
        approvedOutlineVersionId: m.approvedOutlineVersionId, brief: m.brief,
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
      const created = await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, appliedFindingsVersion(rev, ctx.project));
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
          statuses: (r.schema.statuses ?? []).map((s) => ({ value: s.value, label: s.label, requires_reason: Boolean(s.requiresReason) })),
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
      await ctx.recordStageEvaluation(ctx.stage.id, version.id, evaluationRecord(res, ctx.project.model, 'manual'));
      const e = res.evaluation;
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'], changes: { version_ids: [version.id] },
        output: `Alignment ${e.alignment.score} · Clarity ${e.clarity.score} · Drift ${e.drift.score}` +
          (e.findings?.length ? ` · ${e.findings.length} finding(s)` : '') +
          (e.interpretation?.bullets.length ? `\n\n${e.interpretation.label}:\n${e.interpretation.bullets.map((l) => `- ${l}`).join('\n')}` : ''),
      });
    }

    case 'advance': {
      const target = ctx.stage.transitions.default_next;
      const evaluation = evaluateStage(ctx.template, ctx.stage.id, ctx.context);
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
      await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
        type,
        stage_id: ctx.stage.id,
        to_stage_id: target ?? undefined,
        actor,
        agent_run_id: actor === 'system' ? ctx.run.id : null,
        reason: ctx.step.rationale || undefined,
        ...(type === 'stage_marked_complete' && evidence ? { payload: { evidence_version_id: evidence } } : {}),
        ...(type === 'stage_advanced' && ctx.bundles[ctx.stage.id]?.versions.at(-1)
          ? { payload: { left_version_id: ctx.bundles[ctx.stage.id]!.versions.at(-1)!.id } }
          : {}),
      });
      await ctx.afterStageEvent();
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: { event_types: [type] },
        output: type === 'stage_marked_complete'
          ? `Marked ${ctx.stage.label} complete and moved on.`
          : `Moved on from ${ctx.stage.label}, leaving it open: ${evaluation.unmet.map((c) => c.label).join('; ') || 'requirements not met'}.`,
      });
    }

    case 'block': {
      const kind = (['tool_missing', 'data_missing', 'needs_decision'] as const).find((k) => k === params.block_kind) ?? 'needs_decision';
      const reason = (typeof params.reason === 'string' && params.reason.trim()) || ctx.step.rationale || 'Go mode could not continue.';
      const actor = ctx.approvedByUser || ctx.run.policy === 'guided' ? 'user' : 'system';
      await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
        type: 'stage_blocked',
        stage_id: ctx.stage.id,
        actor,
        agent_run_id: actor === 'system' ? ctx.run.id : null,
        reason,
        payload: { block_kind: kind },
      });
      await ctx.afterStageEvent();
      return done(key, {
        status: 'blocked', blockKind: kind, toolsUsed: [], changes: { event_types: ['stage_blocked'] },
        output: `Could not continue: ${reason}`, stop: { status: 'blocked', reason },
      });
    }

    case 'ask':
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: {},
        output: ctx.step.decision_question || 'Which way should this go?',
        stop: { status: 'awaiting_decision', reason: ctx.step.decision_question || 'Go mode needs your decision.' },
        needs: { kind: 'answer_question', question: ctx.step.decision_question || 'Which way should this go?' },
      });

    case 'complete':
      // PM-25: the model's opinion is not enough — the deliverable has to exist.
      return ctx.deliverableDone
        ? done(key, {
            status: 'succeeded', toolsUsed: [], changes: {},
            output: 'The objective is met and the deliverable is done. Nothing needs another pass.',
            stop: { status: 'completed', reason: 'Objective met.' },
          })
        : done(key, {
            status: 'succeeded', toolsUsed: [], changes: {},
            output: 'The model judged the objective met, but the deliverable is not done yet, so the run stops here for you to decide.',
            stop: { status: 'awaiting_decision', reason: 'The model thinks the work is done, but the deliverable is not. Your call.' },
          });

    default:
      return done(key, { status: 'failed', output: `Unknown action "${key}".`, toolsUsed: [], changes: {} });
  }
}
