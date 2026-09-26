/**
 * What the planner is told about the project (B2's AgentState). Pure.
 *
 * The same shape the backend validates; trimmed here because the planner runs
 * on every step and a whole manuscript in every call would be paying for the
 * same context over and over.
 */

import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { nextSuggestedStage } from '@/lib/workflow/engine';
import type { StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';
import type { Evaluation } from '@/types/project';

export const ARTIFACT_EXCERPT_CHARS = 12_000;
export const RECENT_STEPS = 8;

export interface AgentStateDigest {
  stage_id: string;
  stage_label: string;
  stage_instruction: string;
  artifact_excerpt: string;
  criteria_met: string[];
  criteria_unmet: string[];
  evaluation: string;
  next_stage_label: string;
  prior_stages: string[];
  recent_steps: { action_key: string; status: string; execution_label: string | null; output: string }[];
}

export function buildAgentState(input: {
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  stageEvaluation: StageEvaluation;
  latestEvaluation?: Evaluation | null;
  steps: readonly AgentStep[];
}): AgentStateDigest {
  const { template, state, stage, bundles, stageEvaluation, latestEvaluation, steps } = input;
  const content = bundles[stage.id]?.versions.at(-1)?.content ?? '';
  const next = nextSuggestedStage(template, state);
  const index = template.stages.findIndex((s) => s.id === stage.id);
  const ev = latestEvaluation;
  return {
    stage_id: stage.id,
    stage_label: stage.label,
    stage_instruction: stage.entry_prompt_hint || stage.entry_guidance,
    artifact_excerpt:
      content.length > ARTIFACT_EXCERPT_CHARS ? content.slice(0, ARTIFACT_EXCERPT_CHARS) + '\n[… trimmed …]' : content,
    criteria_met: stageEvaluation.criteria.filter((c) => c.satisfied).map((c) => c.label),
    // A box only the user ticks cannot be satisfied by rewriting the draft —
    // without saying so, a real planner revised three times to tick one (B4).
    criteria_unmet: stageEvaluation.unmet.map((c) =>
      c.manual ? `${c.label} (ticked by the user when satisfied — revising cannot satisfy it)` : c.label
    ),
    evaluation: ev
      ? `alignment ${ev.alignment_score}, clarity ${ev.clarity_score}, drift ${ev.drift_score}` +
        (ev.findings?.length ? `; ${ev.findings.length} finding(s)` : '') +
        // PM-25: the evaluator's own "no further pass needed" reaches the planner.
        (ev.further_pass_needed === false
          ? `; evaluator: no further AI pass needed${ev.further_pass_reason ? ` (${ev.further_pass_reason})` : ''}`
          : '')
      : '',
    next_stage_label: next ? (template.stages.find((s) => s.id === next)?.label ?? next) : '',
    prior_stages: template.stages
      .slice(0, Math.max(0, index))
      .map((s) => `${s.label}: ${state.stages[s.id]?.status ?? 'not_started'}`),
    recent_steps: steps
      .filter((s) => s.status !== 'running')
      .slice(-RECENT_STEPS)
      .map((s) => ({
        action_key: s.action_key,
        status: s.status,
        execution_label: s.execution_label,
        output: s.output.slice(0, 600),
      })),
  };
}
