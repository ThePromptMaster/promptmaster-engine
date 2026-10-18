/**
 * The short account of a Go run (Q3c). Pure, and derived from the step
 * record — never written by a model.
 *
 * Sean, 9 Oct: "The main experience should be: give it a goal or question,
 * press Go, and receive a short account of what it did, what it is doing
 * next, or exactly why it paused. The detailed stages, evidence, and history
 * remain available underneath." And: "A resource-window pause should
 * preserve progress and be distinguished from a technical blocker or
 * completion."
 */

import type { AgentRun, AgentStep } from '@/types/agent';
import { actionFor, actionLabel, ROUTINE_DEFAULT_STEP } from './actions';
import { describeNeed, isClearedNote, type NeedsUser } from './needs';

export type PauseKind = 'working' | 'window' | 'blocker' | 'decision' | 'complete' | 'stopped';

export interface RunAccount {
  /** "Ran 3 computations in the sandbox; derived 1 result; …", or '' before anything was done. */
  did: string;
  kind: PauseKind;
  /** What it is doing now, or exactly why it paused. */
  now: string;
  /** What it set aside rather than stop for, each in a line. */
  setAside: string[];
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function firstSentence(text: string): string {
  const t = text.trim().split('\n')[0];
  const m = /^(.{20,}?[.?!])\s/.exec(`${t} `);
  return (m ? m[1] : t).slice(0, 300);
}

export function runAccount(run: AgentRun | null, steps: readonly AgentStep[], stageLabel: (id: string) => string): RunAccount | null {
  if (!run) return null;
  const ok = steps.filter((s) => s.status === 'succeeded');
  const executed = ok.filter((s) => s.execution_label === 'code_executed' || s.execution_label === 'simulation_run').length;
  const derived = ok.filter((s) => actionFor(s.action_key)?.performer === 'reason').length;
  const lookups = ok.filter((s) => s.action_key === 'check_literature').length;
  const repaired = new Set(ok.filter((s) => s.action_key === 'recheck_stage' && !s.params?.measured).map((s) => String(s.params?.stage_id ?? s.stage_id ?? '')));
  // 11 Oct: shortening a brief to its limit is not "a repair after a change".
  const fitted = new Set(ok.filter((s) => s.action_key === 'recheck_stage' && s.params?.measured).map((s) => String(s.params?.stage_id ?? s.stage_id ?? '')));
  const written = new Set(
    ok.filter((s) => ['draft_stage', 'revise_stage', 'apply_findings', 'draft_sections', 'revise_sections'].includes(s.action_key) && s.stage_id).map((s) => s.stage_id!)
  );
  const returns = ok.filter((s) => s.action_key === 'return_to_stage');
  const parts = [
    executed ? `ran ${n(executed, 'computation')} in the sandbox` : '',
    derived ? `worked out ${n(derived, 'result')} by reasoning (not executed)` : '',
    lookups ? `searched the literature ${n(lookups, 'time')}` : '',
    written.size ? `wrote or revised ${[...written].map(stageLabel).join(', ')}` : '',
    repaired.size ? `repaired ${[...repaired].filter(Boolean).map(stageLabel).join(', ')} after a change` : '',
    fitted.size ? `revised ${[...fitted].filter(Boolean).map(stageLabel).join(', ')} to meet a requirement measured in code` : '',
    returns.length ? `went back ${n(returns.length, 'time')} for further work (${returns.map((s) => stageLabel(String(s.params?.stage_id ?? ''))).join(', ')})` : '',
  ].filter(Boolean);
  const did = parts.length ? `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) : '';

  const setAside = [
    ...steps.filter((s) => typeof s.params?.set_aside_question === 'string').map((s) => `Question kept for you: ${String(s.params!.set_aside_question).slice(0, 300)}`),
    ...steps.filter((s) => typeof s.changes?.set_aside === 'string').map((s) => `Could not be done here: ${s.changes!.set_aside}`),
    ...steps.filter((s) => s.action_key === ROUTINE_DEFAULT_STEP && s.status === 'succeeded').map((s) => firstSentence(s.output).replace(/^Routine default taken by Go under your routine-decision policy \(yours to change\): /, 'Routine default taken (yours to change): ')),
  ];

  const reason = run.stop_reason?.trim() ?? '';
  const current = steps.at(-1);
  switch (run.status) {
    case 'running':
      return { did, kind: 'working', now: current?.status === 'running' ? `Doing now: ${actionLabel(current.action_key)}${current.stage_id ? ` on ${stageLabel(current.stage_id)}` : ''}.` : 'Choosing the next move.', setAside };
    case 'budget_exhausted':
      return { did, kind: 'window', now: 'Paused at the end of this window — a resource limit, not a problem. Everything is saved; Continue picks up from here and does not repeat finished work.', setAside };
    case 'blocked':
      // A loop stop is not a missing tool or missing data (Sean, 10 Oct, email 7.6:
      // "distinguish a step-budget pause from a technical block and from project completion").
      if (/^Going round in circles: /.test(reason)) {
        return { did, kind: 'blocker', now: `Stopped to avoid repeating itself: ${firstSentence(reason.replace(/^Going round in circles: /, ''))} Nothing is lost; tell Go what to do differently, or do it yourself.`, setAside };
      }
      return { did, kind: 'blocker', now: `Can't continue: ${firstSentence(reason) || 'something it needs is missing.'}`, setAside };
    case 'awaiting_decision':
      // The decision itself, not the stop's statement (11 Oct: "Your decision
      // is needed" over a sentence that asked nothing).
      // A cleared request asks nothing (15 Oct screenshot: "Your decision is
      // needed: That is done. Press Resume and I will carry on.").
      if (!run.needs && isClearedNote(reason)) return { did, kind: 'decision', now: reason, setAside };
      return { did, kind: 'decision', now: `Your decision is needed: ${decisionAsked(run.needs ?? null, reason, stageLabel)}`, setAside };
    case 'completed':
      // What was deferred is said with the finish, not counted as resolved (10 Oct, 6.6).
      return {
        did, kind: 'complete', setAside,
        now: /objective (?:is )?met/i.test(reason)
          ? `Finished: the objective is verified as met.${reason.match(/ Deferred, not blocking[\s\S]*$/)?.[0] ?? ''}`
          : `Finished: ${firstSentence(reason) || 'nothing left to do.'}`,
      };
    case 'failed':
      return { did, kind: 'blocker', now: `Stopped on an error: ${firstSentence(reason) || 'see the record below.'}`, setAside };
    default:
      return { did, kind: 'stopped', now: 'Stopped by you. Everything done so far is saved.', setAside };
  }
}

/** What the user is asked to decide, in one line: the request's own buttons when it has them. */
function decisionAsked(need: NeedsUser | null, reason: string, stageLabel: (id: string) => string): string {
  if (need && need.kind !== 'answer_question') {
    const d = describeNeed(need, stageLabel);
    const choices = d.options?.map((o) => o.label) ?? (d.action ? [d.action] : []);
    if (choices.length) return `${choices.map((c) => `“${c}”`).join(' or ')}. ${firstSentence(d.message)}`;
  }
  return firstSentence(reason) || 'see below.';
}
