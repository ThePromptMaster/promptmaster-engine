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
  const repaired = new Set(ok.filter((s) => s.action_key === 'recheck_stage').map((s) => String(s.params?.stage_id ?? s.stage_id ?? '')));
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
      return { did, kind: 'blocker', now: `Can't continue: ${firstSentence(reason) || 'something it needs is missing.'}`, setAside };
    case 'awaiting_decision':
      return { did, kind: 'decision', now: `Your decision is needed: ${firstSentence(reason) || 'see below.'}`, setAside };
    case 'completed':
      return { did, kind: 'complete', now: /objective (?:is )?met/i.test(reason) ? 'Finished: the objective is verified as met.' : `Finished: ${firstSentence(reason) || 'nothing left to do.'}`, setAside };
    case 'failed':
      return { did, kind: 'blocker', now: `Stopped on an error: ${firstSentence(reason) || 'see the record below.'}`, setAside };
    default:
      return { did, kind: 'stopped', now: 'Stopped by you. Everything done so far is saved.', setAside };
  }
}
