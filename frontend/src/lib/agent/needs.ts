/**
 * What Go mode needs from the user before it can go on (B4). Pure.
 *
 * Sean, 28 Sep, item 4: "If Resume cannot continue, I think the interface
 * should tell me very directly: I need you to do this before I can continue.
 * And ideally put that exact action right there." These are the things Go
 * never does itself — approving an outline, unblocking a stage, ticking a box
 * that is the user's to tick, spending another window — stated as data so
 * the panel can render the message and the one button that clears it.
 */

import { isLargeJob } from '@/components/workflow/large-job-warning';
import type { AgentStep, ExecutionPolicy } from '@/types/agent';
import type { ExitCriterion, StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import { isDone } from '@/lib/workflow/types';
import type { RoutineDecisions } from '@/types/project';
import type { StageFacts } from './facts';
import type { InputsChange } from '@/lib/workflow/stage-inputs';
import { awaitsAttempt, confirmableProposals } from '@/lib/workflow/stage-artifact';
import { rowsRequired } from '@/lib/workflow/engine';
import { confirmProposalsLabel } from '@/lib/workflow/stage-controls';

type Need =
  | { kind: 'set_objective' }
  | { kind: 'unblock_stage'; stageId: string; reason: string; blockKind: string }
  | { kind: 'approve_outline'; stageId: string; versionNumber: number | null; unsavedDraft: boolean }
  | {
      kind: 'tick_criterion'; stageId: string; criterionId: string; label: string; hint?: string;
      /**
       * Why the policy cannot cover it (Sean, 5 Oct: "say what decision is
       * needed, why it cannot resolve it under the current policy, and what
       * answering will unlock"). 'reserved': only the user decides it;
       * 'policy_ask': routine, but routine decisions are set to Ask me.
       */
      authority?: 'reserved' | 'policy_ask';
    }
  | {
      kind: 'answer_question'; question: string; /** Q3a: the expert review package, as markdown. */ expertPackage?: string;
      /** Answers the user can click (13 Oct); the text box stays for anything else. */
      choices?: string[];
    }
  | { kind: 'wait_for_jobs'; stageId: string; pending: number; complete: number; total: number }
  | { kind: 'continue_budget'; budgetSteps: number }
  | { kind: 'large_job'; stageId: string; sections: number }
  | { kind: 'triage_findings'; stageId: string; count: number }
  /**
   * A repair that did not settle (13 Oct, Sean: "The recovery should identify
   * the unresolved requirement, explain why the repair didn't resolve it, and
   * offer an actionable next step"). `why`: what reopened it and is still
   * unresolved; `last`: what the last attempt did, in the record's words.
   */
  | { kind: 'repair_stuck'; stageId: string; why: string; last: string; tries: number; saved: number }
  /** Go thinks this stage is not the best next move; skipping it is the user's call. */
  | { kind: 'skip_stage'; stageId: string; reason: string }
  /** Go's proposal to start another round of a looping workflow; the user starts it. */
  | { kind: 'next_round'; stageId: string; toStageId: string; reason: string }
  /** An outcome table's rows (claims, runs…) are all the user's to decide. */
  | { kind: 'decide_rows'; stageId: string; count: number; itemLabel: string; proposed?: number }
  /**
   * The objective check stopped the run (11 Oct, survey brief: "The objective
   * is not met yet" with nothing named, then "Your decision is needed" with no
   * decision). Every such stop says what it found and what each button does.
   *  - `unmet`: the requirements found unmet, by name;
   *  - `no_evidence`: called met, but no passage of the deliverable showed it;
   *  - `stages_left`: met, with the workflow still holding stages;
   *  - `work_open`: the deliverable is written, other work is still open.
   */
  | {
      kind: 'objective_check';
      stageId: string;
      finding: 'unmet' | 'no_evidence' | 'stages_left' | 'work_open';
      /** The unmet requirements, the open work, or the stages left — as the record names them. */
      items: string[];
      /** The stage Go moves to next, for `stages_left`. */
      next?: string;
      /** The stage the objective was met on, for `stages_left` when it is not the one the run is on. */
      metOn?: string;
    };

/**
 * `onStage` is the stage the project was on when the run stopped. A request
 * raised on a stage the project has since left is not shown (1 Oct, item 1:
 * "Go sometimes continued to display an old human request after the project
 * appeared to have advanced").
 */
export type NeedsUser = Need & { onStage?: string };

/** What the run says once the user has done what it asked for, themselves. */
export const NEED_CLEARED = 'Ready to carry on — press Resume.';
/**
 * …and once the project has left the stage the request was about. Nothing
 * was done: "That is done" over findings the user chose to leave undecided
 * was simply untrue (production pass, 2026-10-01).
 */
export const NEED_MOVED_ON = 'The project has moved past that stage — press Resume to carry on from here.';

/** The button on a request that is settled row by row: it takes the user to the rows. */
export const SHOW_TABLE = 'Go to the table';

/**
 * Requests whose button shows the way rather than doing the thing: deciding a
 * row is several choices, each the user's, so no one click can stand for them.
 */
export function needIsDecidedOnStage(need: Pick<NeedsUser, 'kind'>): boolean {
  return need.kind === 'decide_rows' || need.kind === 'triage_findings';
}

/** Whether a stop reason is one of the two "nothing is asked of you now" notes. */
export function isClearedNote(reason: string | null | undefined): boolean {
  return reason === NEED_CLEARED || reason === NEED_MOVED_ON;
}

/**
 * Moves that produce the stage's own work. With none of these left and only
 * boxes the user ticks unmet, the next move is the user's.
 *
 * The research moves (Compare alternatives, Derive, …) are not here: they
 * reason about the work but cannot tick an approval. Counting them let a
 * custom workflow's Evidence stage, whose only open item was "I approve this
 * evidence base", run Compare alternatives three times and stop on the
 * repeat instead of at the approval (4 Oct). Revise is not here either:
 * revising cannot tick a box (Positioning, 2026-09-29).
 */
const STAGE_WORK_MOVES = new Set(['draft_stage', 'generate_outline', 'draft_sections', 'revise_sections', 'triage_findings', 'propose_statuses']);

/**
 * Everything still open on the stage is a box only the user ticks, and at
 * least one of them is required. An optional automatic item still open
 * ("three works verified") is work Go can do, so it is not the boundary yet.
 */
export function onlyApprovalLeft(stageEvaluation: StageEvaluation): boolean {
  const blockingUnmet = stageEvaluation.unmet.filter((c) => c.blocking);
  return blockingUnmet.length > 0 && stageEvaluation.unmet.every((c) => c.manual);
}

/** "Approve it as it stands", "approve as is", "no further changes". */
const AS_IT_STANDS = /\b(?:as it stands|as is|without (?:further |more )?(?:changes|checks|checking)|no (?:further|more) changes)\b/i;

/**
 * The user's latest answer on this stage, given since its latest saved
 * version, says to approve that version as it stands. Go then checks and
 * applies nothing more there: on production (19 Oct, Research › Method) it
 * checked again and applied a finding straight after "Approve the analysis
 * plan as it stands", and the user was asked to approve a version they had
 * not seen. Pure.
 */
export function approvedAsItStands(steps: readonly AgentStep[], stageId: string): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.stage_id !== stageId) continue;
    if (s.changes?.version_ids?.length) return false;
    if (s.action_key === 'user_answer') return AS_IT_STANDS.test(s.output) && /\b(?:approv|accept|keep)/i.test(s.output);
  }
  return false;
}

function authorityOf(stage: StageDefinition, criterionId: string): 'delegable' | 'reserved' {
  return stage.exit_criteria.find((c) => c.id === criterionId)?.authority === 'delegable' ? 'delegable' : 'reserved';
}

/** Moves that reason about the work; they cannot tick an approval. */
const REASONING_MOVES = new Set([
  'derive', 'prove', 'simplify', 'limiting_case', 'try_contradiction', 'run_computation',
  'falsify_hypothesis', 'compare_alternatives', 'check_literature', 'update_assumptions', 'search_web',
]);

/** The first row awaiting an attempt, as the planner would name it (1-based), with what it is to compute. */
export function nextRunToAttempt(facts: StageFacts): { row: number; goal: string; why: string } | null {
  const review = facts.review;
  if (!review?.schema.execution) return null;
  const i = review.items.findIndex((item) => awaitsAttempt(item, review.schema));
  if (i < 0) return null;
  const item = review.items[i];
  const field = review.schema.execution.producibleField ?? '';
  const why = (item[field] ?? '').replace(/^promptmaster\s*[—–:-]*\s*/i, '').trim() || 'no dataset is needed';
  const goal = (item[review.schema.fields[0]?.key ?? ''] ?? '').trim().slice(0, 1500) || `Row ${i + 1}`;
  return { row: i + 1, goal, why: why.slice(0, 160) };
}

export interface RequiredMove {
  key: string;
  rationale: string;
  expected: string;
  params?: Record<string, unknown>;
}

/**
 * A finished stage a change reopened, to repair before anything else (6 Oct).
 *
 * Sean: "revising Output changed the recommendation to B, and Summary was
 * correctly flagged for rechecking. But Summary still recommended A." A stage
 * marked for a recheck is outstanding work (`outstandingWork`); this makes it
 * Go's next move, earliest first, so a repair upstream is carried into the
 * stages after it. Prose, list and review stages only — a manuscript or an
 * outline is the user's editor. `tried`: stages this run already rechecked,
 * so one that still cannot be closed is not repaired again in a loop.
 *
 * In a workflow that loops, only up to the stage the project is on: going
 * back a round marks the whole round stale, and repairing its Analysis before
 * its Investigate was redone did the round backwards (7 Oct, E2E). Otherwise
 * every stale stage, through to the final bundle: a fact changed at
 * Consistency left the finished announcement saying the old date (8 Oct,
 * TeamNotes). A stage whose repair failed is tried once more, no more.
 */
export const REPAIR_TRIES = 2;

/**
 * The repairs already tried, one stage id per try, for `staleRepair`.
 *
 * A reopened stage counts the tries for its current reopening (each repair
 * step records it as `stale_since`), so a later change reopens it afresh
 * (8 Oct, production). A measured repair of a finished stage (L-63) counts
 * only measured repairs: on production, TaskBoard's Output had been repaired
 * three times after fact changes, and those used up the measured repair's
 * tries before it was ever made (9 Oct).
 */
export function repairTries(steps: readonly AgentStep[], state: WorkflowState, thisRun: ReadonlySet<string>): string[] {
  return steps
    .filter((s) => s.action_key === 'recheck_stage')
    .filter((s) => {
      const since = state.stages[String(s.params?.stage_id ?? '')]?.stale?.since;
      if (!since) return Boolean(s.params?.measured) || Array.isArray(s.params?.carried);
      // Unmarked (a step the planner chose): counted within this run.
      return s.params?.stale_since === since || (!s.params?.stale_since && thisRun.has(s.id));
    })
    .map((s) => String(s.params?.stage_id ?? ''));
}

/**
 * A reopened stage whose repairs are used up and which is still reopened, or
 * null (13 Oct, Sean's screenplay: Continuity stayed "awaiting recheck" after
 * its two repairs, and nothing said so until the objective check, three
 * stages later). It is the user's next decision, said as one.
 */
export function exhaustedRepair(template: WorkflowTemplate, state: WorkflowState, tried: readonly string[]): string | null {
  for (const stage of template.stages) {
    if (state.stages[stage.id]?.status !== 'stale') continue;
    if (tried.filter((id) => id === stage.id).length >= REPAIR_TRIES) return stage.id;
  }
  return null;
}

/** The `repair_stuck` need for a stage, from the repair steps recorded for it. */
export function repairStuckNeed(state: WorkflowState, stageId: string, steps: readonly AgentStep[], fallbackWhy = ''): Extract<NeedsUser, { kind: 'repair_stuck' }> {
  const repairs = steps.filter((s) => s.action_key === 'recheck_stage' && String(s.params?.stage_id ?? s.stage_id) === stageId);
  const recent = repairs.slice(-Math.max(REPAIR_TRIES, 3));
  const saved = recent.filter((s) => {
    if (s.status !== 'succeeded') return false;
    const c = (s.changes ?? {}) as { version_ids?: unknown; sections_written?: unknown };
    return (Array.isArray(c.version_ids) && c.version_ids.length > 0) || (Array.isArray(c.sections_written) && c.sections_written.length > 0);
  }).length;
  const last = recent.at(-1);
  return {
    kind: 'repair_stuck',
    stageId,
    why: state.stages[stageId]?.stale?.reason || fallbackWhy || 'something it relied on changed',
    last: last?.output ?? '',
    tries: recent.length,
    saved,
  };
}

export function staleRepair(
  template: WorkflowTemplate,
  state: WorkflowState,
  tried: readonly string[] = [],
  /** Measured requirements per stage (C1): a finished stage failing one is repaired too (L-63). */
  measured: Readonly<Record<string, readonly { satisfied: boolean; label: string; detail?: string }[]>> = {},
  /**
   * Stages with a saved version. A stage still in progress that has one and
   * fails a measured requirement is repaired as well (11 Oct, survey brief:
   * "If length is the issue, I'd expect Go to shorten the brief … save it,
   * and recheck automatically").
   */
  drafted: ReadonlySet<string> = new Set(),
  /**
   * Under "handle them for me": review findings carried forward as still
   * unmet, and the finished deliverable they are about. Revised and rechecked
   * rather than waited on (12 Oct; Sean: "If it needs correcting, I'd expect
   * Go to revise and recheck automatically under these settings").
   */
  carried: { deliverableId: string; rows: readonly string[] } | null = null
): RequiredMove | null {
  const loops = template.stages.some((s) => s.transitions.loop_to);
  const here = template.stages.findIndex((s) => s.id === state.current_stage_id);
  // Past the current stage only when the work up to it is settled — not while
  // the user has gone back to redo it — and only what a change reopened (a
  // stage reopened by going back carries no `stale` record).
  const reworking = ['in_progress', 'not_started'].includes(state.stages[state.current_stage_id]?.status ?? 'not_started');
  const ahead = !loops && !reworking;
  for (const [index, stage] of template.stages.entries()) {
    const st = state.stages[stage.id];
    if (here >= 0 && index > here && !(ahead && st?.stale)) continue;
    if (tried.filter((id) => id === stage.id).length >= REPAIR_TRIES) continue;
    // L-63 (9 Oct): "Announcement: 100–140 words — 74 words" on a finished
    // stage was reported and left; it is repaired, and the stage stays finished.
    const open = st?.status === 'in_progress' && drafted.has(stage.id);
    const failing = (isDone(st?.status) || open) && stage.renderer === 'prose' ? (measured[stage.id] ?? []).filter((m) => !m.satisfied) : [];
    if (failing.length && (here < 0 || index <= here || ahead)) {
      const list = failing.map((m) => `${m.label} — measured ${m.detail ?? 'not met'}`).join('; ');
      return {
        key: 'recheck_stage',
        rationale: `${stage.label} ${open ? 'is drafted' : 'is finished'}, but a requirement measured in code is not met: ${list}. This is routine: I revise it to meet ${failing.length === 1 ? 'it' : 'them'}, keep everything else it says, save it and measure again.`,
        expected: `A new version of ${stage.label} that meets ${failing.map((m) => m.label).join('; ')}, measured again in code.`,
        params: { stage_id: stage.id, measured: true },
      };
    }
    if (st?.status !== 'stale') {
      if (carried?.rows.length && stage.id === carried.deliverableId && isDone(st?.status) && stage.renderer === 'prose') {
        const rows = carried.rows.slice(0, 8);
        return {
          key: 'recheck_stage',
          rationale: `A review carried forward ${rows.length === 1 ? 'a finding' : `${rows.length} findings`} saying ${stage.label} is still not right: ${rows.map((r) => `"${r.length > 160 ? `${r.slice(0, 157).trimEnd()}…` : r}"`).join('; ')}. Under your routine-decision policy I revise ${stage.label} to address ${rows.length === 1 ? 'it' : 'them'}, keep everything else, save it and recheck.`,
          expected: `A new version of ${stage.label} that addresses the carried-forward findings; the review is then rechecked against it.`,
          params: { stage_id: stage.id, carried: rows },
        };
      }
      continue;
    }
    // L-64 (9 Oct): a reopened manuscript is repaired by revising its sections.
    if (!['prose', 'list', 'review', 'long_form'].includes(stage.renderer)) continue;
    return {
      key: 'recheck_stage',
      rationale: `${stage.label} was reopened: ${st.stale?.reason ?? 'something it relied on changed'}. Repairing it keeps the project consistent.`,
      expected: `A new version of ${stage.label} that keeps what still holds and replaces what the change superseded; then it is marked complete again.`,
      params: { stage_id: stage.id, ...(st.stale?.since ? { stale_since: st.stale.since } : {}) },
    };
  }
  return null;
}

/**
 * Rows whose proposed status Go may confirm under "handle them for me" (6 Oct:
 * "Autonomous stopped at three row-status decisions instead of preparing the
 * repairs"). Not on a stage with an approval reserved to the user and blocking
 * — Analysis's "I accept each verdict" — where the rows are that decision.
 */
export function policyConfirmable(
  stage: StageDefinition,
  facts: StageFacts,
  routine: RoutineDecisions | undefined
): number {
  if (routine !== 'handle' || !facts.review) return 0;
  const reserved = stage.exit_criteria.some((c) => c.check === 'manual' && c.blocking && c.authority !== 'delegable');
  if (reserved) return 0;
  return confirmableProposals(facts.review.items, facts.review.schema).length;
}

/**
 * The routine approval Go may commit on this stage now, or null (5 Oct).
 *
 * Only under "Routine decisions: handle them for me"; only a blocking box the
 * template marks delegable; and not one whose check already failed on the
 * current version (`tried`) — that is work to revise toward, not to re-check.
 */
export function delegableToCommit(
  stage: StageDefinition,
  stageEvaluation: StageEvaluation,
  routine: RoutineDecisions | undefined,
  tried: readonly string[] = []
): ExitCriterion | null {
  if (routine !== 'handle') return null;
  for (const unmet of stageEvaluation.unmet) {
    if (!unmet.blocking || !unmet.manual || tried.includes(unmet.id)) continue;
    const c = stage.exit_criteria.find((x) => x.id === unmet.id);
    if (c?.check === 'manual' && c.authority === 'delegable') return c;
  }
  return null;
}

/**
 * What the stage itself still requires, in order, before anything optional:
 * finish a cut-off draft; then — once only the user's approval is left —
 * apply the check's findings and check again, so the user is asked to approve
 * work that has had its fixes (Sean, 4 Oct: "finish the incomplete artifact;
 * apply the stage-check findings it can handle; re-check; if only a human
 * approval remains, stop and ask me; only then choose optional actions").
 *
 * Pure. Only moves in `allowed` are returned, so the polish cap still bounds
 * apply and check.
 */
export function requiredWork(input: {
  stage: StageDefinition;
  facts: StageFacts;
  stageEvaluation: StageEvaluation;
  allowed: readonly string[];
  /** The project's "Routine decisions", and approvals whose check failed on the current version. */
  routine?: RoutineDecisions;
  commitTried?: readonly string[];
  /**
   * The stage's rows name sources Go has not yet looked up and read in this
   * run (5 Oct: verify what it legitimately can before asking).
   */
  lookupDue?: boolean;
  /**
   * A workflow that loops (Exploration): `staleDraft` when this stage still
   * holds last round's draft. Left to the planner, both moves below were
   * skipped on production (5 Oct) — it reasoned, or asked, instead of
   * drafting, and never proposed the next round.
   */
  round?: { staleDraft: boolean };
  /** Computations the run may still try against this table (`runAttemptsFor`). */
  runAttemptsLeft?: number;
  /** The user said to approve the current version as it stands (`approvedAsItStands`). */
  asItStands?: boolean;
}): RequiredMove | null {
  const { stage, facts, stageEvaluation, allowed, round } = input;
  const can = (k: string) => allowed.includes(k);

  if (can('extract_facts')) {
    return {
      key: 'extract_facts',
      rationale: 'The attached documents state facts that are not on record yet; recording them, each quoted from its file, means every stage and check reads the same evidence.',
      expected: 'The documents\' facts recorded as accepted facts under your routine-decision policy, each citing its file.',
    };
  }

  if (can('confirm_proposals')) {
    return {
      key: 'confirm_proposals',
      rationale: `${stage.label}'s proposed statuses stand as they are, and your routine decisions are mine to handle.`,
      expected: 'Each proposal confirmed, recorded as confirmed under your routine-decision policy.',
    };
  }

  if (round?.staleDraft && can('draft_stage')) {
    return {
      key: 'draft_stage',
      rationale: `${stage.label} still holds last round's draft; this round needs its own.`,
      expected: `A new draft of ${stage.label} built on what this round found.`,
    };
  }
  if (round && stage.transitions.loop_to && stageEvaluation.canAdvance && can('propose_next_round')) {
    return {
      key: 'propose_next_round',
      rationale: `This round's question is written; the next round can take it on.`,
      expected: 'A proposal to start the next round, for you to accept.',
    };
  }

  if (facts.draft?.truncated && can('continue_writing')) {
    return {
      key: 'continue_writing',
      rationale: `The ${stage.label} draft was cut off before it finished; finishing it comes before anything else.`,
      expected: 'The draft continues from where it stopped, as a new version.',
    };
  }

  if (input.lookupDue && can('check_literature')) {
    return {
      key: 'check_literature',
      rationale: `${stage.label} names sources; looking them up and reading their abstracts comes before handing the rows to you.`,
      expected: 'Each source found in OpenAlex and checked against its row where the abstract allows; the rest left for you.',
    };
  }

  // A row PromptMaster can carry out from what the project states is
  // carried out, not handed to the user as "not run" (Q1a; Sean, 9 Oct).
  const attempt = (input.runAttemptsLeft ?? 0) > 0 && can('run_computation') ? nextRunToAttempt(facts) : null;
  if (attempt) {
    return {
      key: 'run_computation',
      rationale: `Row ${attempt.row} of ${stage.label} is work PromptMaster can carry out from what the project states (${attempt.why}); running it rather than leaving it "not run".`,
      expected: 'The computation run in the sandbox and its output recorded on the row, or the exact reason it could not run.',
      params: { row: attempt.row, goal: attempt.goal },
    };
  }

  if (!onlyApprovalLeft(stageEvaluation) || !facts.draft) return null;

  const findings = facts.evaluationFindings;
  if (!input.asItStands && findings?.aboutHead && findings.count > 0 && can('apply_findings')) {
    return {
      key: 'apply_findings',
      rationale: `Only your approval is left on ${stage.label}, and the stage check raised ${findings.count} finding${findings.count === 1 ? '' : 's'} Go can fix first.`,
      expected: 'A new version with the findings applied.',
    };
  }
  if (!input.asItStands && !facts.draft.checked && can('evaluate_stage')) {
    return {
      key: 'evaluate_stage',
      rationale: `Only your approval is left on ${stage.label}; checking this version first, so you approve work that has been checked.`,
      expected: 'A check of the current version against the objective.',
    };
  }
  // A routine approval, under "handle them for me": checked, then committed (5 Oct).
  const routine = delegableToCommit(stage, stageEvaluation, input.routine, input.commitTried);
  if (routine && can('commit_delegated')) {
    return {
      key: 'commit_delegated',
      rationale: `"${routine.label}" is a routine approval, and your routine decisions are mine to handle; checking ${stage.label} against it before committing it.`,
      expected: 'The approval checked against the stage and, if it holds, committed under your routine-decision policy.',
      params: { criterion_id: routine.id },
    };
  }
  return null;
}

/**
 * Decide, before the planner is asked, whether the next move is the user's.
 *
 * `outlineStageId` is the stage that holds the outline (Book's Outline stage),
 * so a need raised on the approval or drafting stage points at where the
 * approval happens.
 */
export function needsUser(input: {
  state: WorkflowState;
  stage: StageDefinition;
  facts: StageFacts;
  stageEvaluation: StageEvaluation;
  allowed: readonly string[];
  policy: ExecutionPolicy;
  outlineStageId: string | null;
  /** The user already said "draft them anyway" for this many sections. */
  largeJobAcknowledged?: number | null;
  /** Sources on the rows Go has not yet looked up and read in this run. */
  lookupDue?: boolean;
  /** The project's "Routine decisions", and approvals whose check failed on the current version. */
  routine?: RoutineDecisions;
  commitTried?: readonly string[];
  /**
   * How many more computations the run may try against this stage's table:
   * above zero only when the table's rows are things a sandbox run can carry
   * out, the project holds data, and the run has not yet tried once per row.
   */
  runAttemptsLeft?: number;
  /** The user said to approve the current version as it stands (`approvedAsItStands`). */
  asItStands?: boolean;
}): NeedsUser | null {
  const { state, stage, facts, stageEvaluation, allowed, policy, outlineStageId } = input;

  const current = state.stages[stage.id];
  if (current?.status === 'blocked') {
    return { kind: 'unblock_stage', stageId: stage.id, reason: current.blocked?.reason ?? '', blockKind: current.blocked?.kind ?? 'needs_decision' };
  }

  // An outline exists but drafting is not bound to it: only the user approves.
  if (facts.outline && facts.outline.namedSections > 0 && !facts.outline.headApproved) {
    return {
      kind: 'approve_outline', stageId: stage.id,
      versionNumber: facts.outline.head?.version_number ?? null, unsavedDraft: facts.outline.unsavedDraft,
    };
  }
  const wantsApproval = stage.exit_criteria.some((c) => c.rule?.type === 'outline_approved');
  const approvalUnmet = stageEvaluation.unmet.some((c) => stage.exit_criteria.find((x) => x.id === c.id)?.rule?.type === 'outline_approved');
  if (wantsApproval && approvalUnmet && outlineStageId) {
    return { kind: 'approve_outline', stageId: outlineStageId, versionNumber: null, unsavedDraft: false };
  }
  if (facts.manuscript && !facts.manuscript.approvedOutlineVersionId && outlineStageId) {
    return { kind: 'approve_outline', stageId: outlineStageId, versionNumber: null, unsavedDraft: false };
  }

  // FR-18: a large drafting run under Autonomous is a spend the user confirms.
  if (policy === 'autonomous' && allowed.includes('draft_sections') && facts.manuscript) {
    const unwritten = facts.manuscript.total - facts.manuscript.complete;
    if (isLargeJob(unwritten) && input.largeJobAcknowledged !== unwritten) {
      return { kind: 'large_job', stageId: stage.id, sections: unwritten };
    }
  }

  // The findings left are the ones that change the work: the user's call (B3).
  // …unless they are runs and the data to carry them out is here: then a
  // computation can settle a row, and stopping first would leave the data unused.
  const canRun = Boolean(facts.review?.outcome && facts.review.schema.execution && (input.runAttemptsLeft ?? 0) > 0);
  // …or rows still waiting for a proposal Go can make first (3 Oct).
  const canPropose = allowed.includes('propose_statuses') || allowed.includes('confirm_proposals');
  const canLookUp = Boolean(input.lookupDue && allowed.includes('check_literature'));
  // A table that says it does not block finishing never stops Go (C3, 8 Oct):
  // its rows are left as they are, listed as optional. Under "Handle them for
  // me" a required table's rows are Go's to propose and confirm first.
  const optionalRows = Boolean(facts.review?.outcome) && !rowsRequired(stage);
  if (facts.review && !optionalRows && facts.review.material.length > 0 && facts.review.routine.length === 0 && !canRun && !canPropose && !canLookUp) {
    const proposed = confirmableProposals(facts.review.material, facts.review.schema).length;
    return facts.review.outcome
      ? {
          kind: 'decide_rows', stageId: stage.id, count: facts.review.material.length, itemLabel: facts.review.schema.itemLabel,
          // Rows PromptMaster already proposed a status for: one click confirms them (3 Oct).
          ...(proposed > 0 ? { proposed } : {}),
        }
      : { kind: 'triage_findings', stageId: stage.id, count: facts.review.material.length };
  }

  // Everything left to do here is a box only the user ticks. A revise move
  // does not count as work left: revising cannot tick a box, and counting
  // it let an autonomous run move past Positioning with its one required
  // box unticked instead of stopping here (production pass, 2026-09-29).
  const blockingUnmet = stageEvaluation.unmet.filter((c) => c.blocking);
  const workLeft =
    allowed.some((k) => STAGE_WORK_MOVES.has(k)) ||
    // Computations the project's data can still carry out are work, not reasoning.
    (allowed.includes('run_computation') && (input.runAttemptsLeft ?? 0) > 0) ||
    // So is going back for the further work the saved analysis asks for (Q2).
    allowed.includes('return_to_stage') ||
    // An optional automatic item still open is something a lookup or a run may settle.
    (!onlyApprovalLeft(stageEvaluation) && allowed.some((k) => REASONING_MOVES.has(k))) ||
    requiredWork({ stage, facts, stageEvaluation, allowed, routine: input.routine, commitTried: input.commitTried, asItStands: input.asItStands }) !== null;
  // A routine approval whose check failed is repaired, not asked about: Go
  // revises toward it and checks again (Sean, 5 Oct: "'Ask the user' should
  // not be the default response to every failed check").
  const repairable =
    input.routine === 'handle' &&
    allowed.includes('revise_stage') &&
    blockingUnmet.some((c) => (input.commitTried ?? []).includes(c.id) && authorityOf(stage, c.id) === 'delegable');
  if (blockingUnmet.length > 0 && blockingUnmet.every((c) => c.manual) && !workLeft && !repairable) {
    // The user's own decisions first; a routine one is asked only when the policy says ask.
    const c = [...blockingUnmet].sort((a, b) => Number(authorityOf(stage, a.id) === 'delegable') - Number(authorityOf(stage, b.id) === 'delegable'))[0];
    const authority = authorityOf(stage, c.id) === 'delegable' ? (input.routine === 'handle' ? undefined : 'policy_ask') : 'reserved';
    return {
      kind: 'tick_criterion', stageId: stage.id, criterionId: c.id, label: c.label,
      ...(c.hint ? { hint: c.hint } : {}),
      ...(authority ? { authority } : {}),
    };
  }

  return null;
}

/**
 * Whether a stop the run recorded still describes the project. Pure.
 *
 * The request was written when the run stopped and never looked at again: the
 * user approved the outline, ticked the box or decided the rows on the stage
 * itself, and the card went on asking for it. Resume then re-read the project
 * and either carried on or stopped for something else — which is the
 * "sometimes it continues, sometimes nothing happens" of item 22.
 */
export function needStillHolds(
  need: NeedsUser,
  input: Parameters<typeof needsUser>[0] & { objective: string; currentStageId: string }
): boolean {
  // Another window is the user's click whatever stage the project is on.
  if (need.kind === 'continue_budget') return true;
  if (need.onStage && need.onStage !== input.currentStageId) return false;
  switch (need.kind) {
    case 'set_objective':
      return !input.objective.trim();
    case 'answer_question':
    case 'skip_stage':
    case 'next_round':
    case 'objective_check':
      return true;
    case 'unblock_stage':
      return input.state.stages[need.stageId]?.status === 'blocked';
    case 'wait_for_jobs':
      return (input.facts.manuscript?.pendingJobs.length ?? 0) > 0;
    case 'repair_stuck':
      // needsUser never raises this one, so asking it again always said "no":
      // the card was cleared to "That is done. Press Resume", Resume hit the
      // used-up repair again, and round it went (15 Oct, HARBOR). It holds
      // while the stage is still waiting for its recheck.
      return input.state.stages[need.stageId]?.status === 'stale';
    case 'tick_criterion':
      // Asked for directly: the box is either still unticked or it is not.
      // (Going back through needsUser would drop a request raised while other
      // moves were still on offer — see the 'complete' performer.)
      return input.stageEvaluation.unmet.some((c) => c.id === need.criterionId);
    default: {
      const now = needsUser(input);
      return Boolean(now && now.kind === need.kind);
    }
  }
}

/**
 * What the card for a stuck stage can do. Each is a different thing. `clear`
 * lifts the block and leaves the user on the stage — what the More menu's
 * "Continue this stage" does — without Go resuming.
 */
export type StuckOption = 'resume' | 'add_data' | 'skip' | 'retry' | 'clear' | 'fix' | 'stop' | 'keep' | 'open';

/** At most this many ways forward on a stuck card (2 Oct screenshots: five was too many). */
export const STUCK_OPTIONS_MAX = 3;

/** What is true of the project now, for a request whose wording depends on it. */
export interface NeedContext {
  /** Whether the stuck stage's inputs changed since it was marked stuck; null when that was not recorded. */
  blockInputs?: InputsChange | null;
  /** The stuck stage may be skipped. */
  canSkip?: boolean;
  /**
   * The exact label of the stage bar's own transition button, from the
   * controls registry (`stageControls`), so the card can point to it in the
   * words that are on the page. Null when there is none.
   */
  advanceControl?: string | null;
  /** The current stage's approvals the user has not given yet (manual criteria, unticked). */
  openApprovals?: { id: string; label: string }[];
}

const norm = (text: string) =>
  text.toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The approvals a question from Go is asking the user to give.
 *
 * Go asks for an approval in its own words and quotes the requirement — on
 * production (4 Oct) it asked "If yes, use 'I agree this says what is not yet
 * known…'", and the card offered only a text box: the client's "it asks me to
 * tick something and there is no tick". A requirement whose label the question
 * contains is offered as the tick itself. Matched on the label, never guessed.
 */
export function approvalsAskedFor(
  question: string,
  approvals: readonly { id: string; label: string }[] = []
): { id: string; label: string }[] {
  const q = norm(question);
  return approvals.filter((a) => {
    const label = norm(a.label);
    return label.length >= 12 && q.includes(label);
  });
}

/**
 * A stuck stage, described honestly (2 Oct, item 9), with at most three ways
 * forward (2 Oct screenshots: "Skip for now", "Try again without changes",
 * "Resume with what has changed", "Continue this stage" and "Override and
 * continue" were on one screen, and the client could not tell which to pick).
 *
 * The card says whether anything changed. One option leads by situation:
 * resuming when something changed, adding the data when data is what is
 * missing, trying again otherwise. Skipping is offered where the stage
 * allows it. The last is always the plain way out — clear the block and
 * carry on by hand. Overriding stays on the stage bar, and the footer names
 * that button in the words that are on the page.
 */
function describeStuck(
  need: Extract<NeedsUser, { kind: 'unblock_stage' }>,
  stage: string,
  ctx: NeedContext
): { message: string; action: string; options: { id: StuckOption; label: string }[]; footer?: string } {
  const why = `${stage} is marked stuck${need.reason ? `: ${need.reason.replace(/[.\s]+$/, '')}` : ''}.`;
  const skip = ctx.canSkip ? [{ id: 'skip' as const, label: `Skip ${stage} for now` }] : [];
  const clear = { id: 'clear' as const, label: 'Continue this stage by hand' };
  const footer = ctx.advanceControl
    ? `To move on with this still open, use “${ctx.advanceControl}” under More at the bottom of the stage; it asks for your reason.`
    : undefined;
  const lead = ctx.blockInputs?.changed
    ? { id: 'resume' as const, label: 'Resume with what has changed' }
    : need.blockKind === 'data_missing'
      ? { id: 'add_data' as const, label: 'Add the missing data' }
      : { id: 'retry' as const, label: 'Try again' };
  const options = [lead, ...skip, clear].slice(0, STUCK_OPTIONS_MAX);
  const since = ctx.blockInputs?.changed
    ? ` Since then, ${ctx.blockInputs.what.join(' and ')}.`
    : ctx.blockInputs
      ? ' Nothing in the project has changed since, so trying again will most likely stop at the same place.'
      : ' I need that cleared before I can continue.';
  return { message: `${why}${since}`, action: options[0].label, options, footer };
}

/**
 * The sentence the card shows, and the label of the one button that clears it
 * (null: no button, just Resume). A stuck stage has several `options`; the
 * first is the one `action` names.
 */
export function describeNeed(
  need: NeedsUser,
  stageLabel: (id: string) => string,
  ctx: NeedContext = {}
): { message: string; action: string | null; options?: { id: StuckOption; label: string }[]; footer?: string } {
  switch (need.kind) {
    case 'set_objective':
      return { message: 'I need an objective before I can choose a move. Set one above.', action: null };
    case 'unblock_stage':
      return describeStuck(need, stageLabel(need.stageId), ctx);
    case 'approve_outline':
      return need.unsavedDraft
        ? { message: `I need your approval of the outline on ${stageLabel(need.stageId)} before I can continue. It has edits that are not saved yet.`, action: 'Save and approve the outline' }
        : {
            message: `I need your approval of ${need.versionNumber ? `outline version ${need.versionNumber}` : 'the outline'} before I can continue.`,
            action: 'Approve the outline',
          };
    case 'tick_criterion': {
      // What is needed, why the policy cannot cover it, and what answering unlocks (5 Oct).
      const why =
        need.authority === 'reserved'
          ? ' This one is yours alone: it records your own judgment, not something I can check.'
          : need.authority === 'policy_ask'
            ? ' It is a routine approval, but your routine decisions are set to "Ask me".'
            : '';
      return {
        message: `Needs your approval: "${need.label}".${why}${need.hint ? ` ${need.hint}` : ''}`,
        action: 'Approve and resume',
      };
    }
    case 'answer_question':
      return { message: need.question, action: null };
    case 'skip_stage':
      return {
        message: `I suggest skipping ${stageLabel(need.stageId)}: ${need.reason.replace(/\s+$/, '')} You can reopen it later.`,
        action: `Skip ${stageLabel(need.stageId)} for now`,
      };
    case 'next_round':
      return {
        message: `This round is done. ${need.reason.replace(/\s+$/, '')} Start the next round from ${stageLabel(need.toStageId)}, or stop here.`,
        action: `Start the next round from ${stageLabel(need.toStageId)}`,
      };
    case 'wait_for_jobs':
      return {
        message: `${need.pending} section${need.pending === 1 ? ' is' : 's are'} still being written (${need.complete} of ${need.total} done). I can keep waiting.`,
        action: 'Keep waiting',
      };
    case 'continue_budget':
      return {
        message: `This window of ${need.budgetSteps} steps is used up and the work is not done.`,
        action: `Continue for ${need.budgetSteps} more steps`,
      };
    case 'large_job':
      return {
        message: `Drafting ${need.sections} sections is a large run. I need your say-so before spending that.`,
        action: `Draft ${need.sections} sections anyway`,
      };
    case 'decide_rows':
      if (need.proposed) {
        const rest = need.count - need.proposed;
        return {
          message: `I proposed a status for ${need.proposed} ${need.proposed === 1 ? need.itemLabel : `${need.itemLabel}s`}. Press "${confirmProposalsLabel(need.proposed)}" above the table, or change any that read wrong.${rest > 0 ? ` ${rest} more ${rest === 1 ? 'needs' : 'need'} a status from you.` : ''}`,
          action: SHOW_TABLE,
        };
      }
      return {
        message: `${need.count} ${need.count === 1 ? need.itemLabel : `${need.itemLabel}s`} ${need.count === 1 ? 'needs' : 'need'} your decision: set a status on each in the table below.`,
        action: SHOW_TABLE,
      };
    case 'objective_check':
      return describeObjectiveCheck(need, stageLabel);
    case 'repair_stuck':
      return describeRepairStuck(need, stageLabel(need.stageId));
    case 'triage_findings':
      return {
        // Why these were not handled under "Handle them for me" (Sean, 10 Oct,
        // email 7.1): the setting covers minor and moderate findings; these are
        // major, or have no severity, and change what the work says.
        message: `${need.count} major or unrated finding${need.count === 1 ? '' : 's'} ${need.count === 1 ? 'is' : 'are'} yours to decide: accept, reject or defer each in the table below.`,
        action: SHOW_TABLE,
      };
  }
}

/**
 * A repair that did not settle, said as what is still wrong, why the attempts
 * did not fix it, and three ways on (13 Oct): try once more from the current
 * version, keep the stage as it is, or open it and change it by hand.
 */
function describeRepairStuck(
  need: Extract<NeedsUser, { kind: 'repair_stuck' }>,
  stage: string
): { message: string; action: string; options: { id: StuckOption; label: string }[] } {
  const why = need.why.replace(/[.\s]+$/, '');
  const last = need.last.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const attempts = `${need.tries} repair${need.tries === 1 ? '' : 's'} of ${stage}`;
  const saved = need.saved === 0
    ? 'none of them was saved'
    : need.saved === need.tries
      ? `each was saved as a new version (the earlier ones are kept)`
      : `${need.saved} ${need.saved === 1 ? 'was' : 'were'} saved as a new version, the rest were not`;
  const options = [
    { id: 'retry' as const, label: `Try once more from the current version` },
    { id: 'keep' as const, label: `Keep ${stage} as it is now` },
    { id: 'open' as const, label: `Open ${stage}` },
  ];
  return {
    message:
      `I stopped repairing ${stage}: ${attempts} did not settle it, and ${saved}. ` +
      `What is still unresolved: ${why}. ` +
      (last ? `The last attempt: ${last.length > 400 ? `${last.slice(0, 400)}…` : last}. ` : '') +
      `Choose how to go on: try once more (it starts from the current version and keeps every decided row), keep ${stage} as it is now and carry on, or open it and change it yourself.`,
    action: options[0].label,
    options,
  };
}

/** The objective check's stop, with what it found and what each button does (11 Oct). */
function describeObjectiveCheck(
  need: Extract<NeedsUser, { kind: 'objective_check' }>,
  stageLabel: (id: string) => string
): { message: string; action: string; options: { id: StuckOption; label: string }[] } {
  const stage = stageLabel(need.stageId);
  const list = need.items.map((i) => i.replace(/[.\s]+$/, '')).join('; ');
  switch (need.finding) {
    case 'unmet': {
      const options = [
        { id: 'fix' as const, label: `Have Go fix ${stage} and check again` },
        { id: 'stop' as const, label: 'I will fix it myself' },
      ];
      return {
        message: `The objective is not met yet — not met: ${list || 'see the check in the record below'}. I can fix ${stage} and check again.`,
        action: options[0].label, options,
      };
    }
    case 'no_evidence': {
      const options = [
        { id: 'resume' as const, label: 'Carry on' },
        { id: 'stop' as const, label: 'Stop here' },
      ];
      return {
        message: `The check found nothing unmet in ${stage}, but no passage shows the objective is met, so I have not recorded it as met. Carry on, or stop here.`,
        action: options[0].label, options,
      };
    }
    case 'stages_left': {
      const next = need.next ?? need.items[0] ?? 'the next stage';
      // Still on the stage the objective was met on: finishing it is the next move.
      const options = [
        { id: 'resume' as const, label: next === stage ? `Finish ${stage} and carry on` : `Carry on to ${next}` },
        { id: 'stop' as const, label: 'Stop here' },
      ];
      return {
        message: `The objective is met on ${need.metOn ?? stage}, but the workflow is not finished: ${list}. ${next === stage ? `Carrying on marks ${stage} complete and moves to what is left.` : `Carrying on takes me to ${next}.`}`,
        action: options[0].label, options,
      };
    }
    case 'work_open': {
      const options = [
        { id: 'resume' as const, label: 'Carry on with the open work' },
        { id: 'stop' as const, label: 'Stop here' },
      ];
      return {
        message: `${stage} is written, but the work is not finished: ${list}. I will not call the objective met while any of it is open.`,
        action: options[0].label, options,
      };
    }
  }
}
