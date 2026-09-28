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
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
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
import { actionFor, INTERPRET_STEP } from './actions';
import type { AgentStateDigest } from './digest';
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
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  recordStageEvaluation?: (stageId: string, versionId: string, evaluation: NewEvaluation) => Promise<Evaluation>;
  setStageSummary?: (stageId: string, summary: string) => Promise<void>;
  /** Re-read the event log (and move the cursor) after a stage event. */
  afterStageEvent: () => Promise<void>;
  signal: AbortSignal;
}

export interface StepOutcome {
  status: 'succeeded' | 'failed' | 'blocked';
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

export async function performStep(ctx: PerformContext): Promise<StepOutcome> {
  const key = ctx.step.action_key;
  const params = ctx.step.params ?? {};
  const inputs = inputsFrom(ctx.project);
  const model = ctx.project.model || undefined;

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
      const output = [
        classification.summary,
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
      const res = await api.generateStageArtifact(
        generationRequest(ctx.project, ctx.template, ctx.state, ctx.bundles, ctx.stage, revising ? head : ''),
        ctx.signal
      );
      const content = generationContent(ctx.stage, res);
      if (!content) {
        return done(key, { status: 'failed', output: 'The model returned nothing usable.', toolsUsed: ['model'], changes: {} });
      }
      const instruction = typeof params.instruction === 'string' ? params.instruction : '';
      await ctx.appendStageVersion(ctx.stage.id, ctx.stage.label, {
        content,
        source_operation: revising ? 'agent_revise' : 'agent_draft',
        instruction: instruction || ctx.step.rationale || ctx.stage.entry_prompt_hint || '',
        model: res.model_used || ctx.project.model,
        mode: ctx.project.mode,
        change_summary: revising ? `Go mode: ${instruction || 'revised'}` : 'Go mode draft.',
        finish_reason: res.finish_reason || null,
      });
      return done(key, {
        status: 'succeeded', toolsUsed: ['model'], changes: {},
        output: `${revising ? 'Revised' : 'Drafted'} ${ctx.stage.label} — saved as a new version (${content.length.toLocaleString()} characters).`,
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
      // Complete only with the requirements met and evidence to show for it;
      // otherwise move on and leave the stage open, as "Continue anyway" does.
      const type = evaluation.canAdvance && evidence ? 'stage_marked_complete' : 'stage_advanced';
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
        ...(type === 'stage_marked_complete' ? { payload: { evidence_version_id: evidence } } : {}),
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
        output: `Blocked: ${reason}`, stop: { status: 'blocked', reason },
      });
    }

    case 'ask':
      return done(key, {
        status: 'succeeded', toolsUsed: [], changes: {},
        output: ctx.step.decision_question || 'Which way should this go?',
        stop: { status: 'awaiting_decision', reason: ctx.step.decision_question || 'Go mode needs your decision.' },
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
