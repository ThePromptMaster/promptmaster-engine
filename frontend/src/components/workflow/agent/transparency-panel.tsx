'use client';

import { actionLabel } from '@/lib/agent/actions';
import { RUN_STATUS_TEXT as RUN_STATUS, STEP_STATUS_TEXT as STEP_STATUS } from '@/lib/agent/labels';
import { MODE_DISPLAY } from '@/lib/constants';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ModeType } from '@/types';
import { ExecutionBadge } from './execution-badge';

const EVENT_PHRASE: Record<string, string> = {
  stage_marked_complete: 'a stage marked complete',
  stage_advanced: 'the project moved on, leaving the stage open',
  stage_blocked: 'a stage marked stuck',
  stage_unblocked: 'a stage continued',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the step changed in the project, in the user's words (C2, PM-12). */
function changed(step: AgentStep): string {
  const parts: string[] = [];
  const c = step.changes ?? {};
  if (c.event_types?.length) parts.push(c.event_types.map((t) => EVENT_PHRASE[t] ?? t.replace(/_/g, ' ')).join(', '));
  if (c.sandbox_run_id) parts.push('a recorded code run');
  if (c.sections_written?.length) {
    parts.push(step.action_key === 'revise_sections' ? `${plural(c.sections_written.length, 'section')} revised` : `${plural(c.sections_written.length, 'section')} drafted`);
  }
  if (c.items_triaged?.length) parts.push(`${plural(c.items_triaged.length, 'routine finding')} decided`);
  if (c.version_ids?.length) {
    if (step.action_key === 'evaluate_stage') parts.push('an evaluation of the current version');
    else if (step.action_key === 'generate_outline') parts.push('the outline, saved as a version');
    else if (step.action_key === 'apply_findings') parts.push('a new version with the findings applied');
    else if (step.action_key === 'draft_stage' || step.action_key === 'revise_stage') parts.push('a new version of this draft');
    else if (!c.sections_written?.length && !c.items_triaged?.length) parts.push(plural(c.version_ids.length, 'new version'));
  } else if ((step.action_key === 'draft_stage' || step.action_key === 'revise_stage') && step.status === 'succeeded') {
    parts.push('a new version of this draft');
  }
  return parts.length ? parts.join('; ') : 'Nothing in the project — this step only produced the text below.';
}

/**
 * One sentence on where things stand (C2, Sean 28 Sep item 14: "the state
 * machine is too visible"). The record below keeps every exact label.
 */
function narrative(run: AgentRun | null, step: AgentStep | null, next: string, thinking: boolean): string {
  if (!run) return 'Go mode has not started.';
  if (thinking) return 'Choosing the next move…';
  if (!step) return `${RUN_STATUS[run.status]}.`;
  const label = actionLabel(step.action_key);
  switch (step.status) {
    case 'running':
      return `${label} — in progress.`;
    case 'awaiting_decision':
      return `Proposed: ${label}. Waiting for your approval.`;
    case 'succeeded': {
      const what = changed(step);
      const tail = what.startsWith('Nothing in the project') ? 'No change to the project.' : `Changed: ${what}.`;
      return `${label} — done. ${tail}${run.status === 'awaiting_decision' ? ' Waiting for you.' : run.status === 'running' ? ` Next: ${next}.` : ''}`;
    }
    case 'blocked':
      return `${label} — could not continue.`;
    case 'failed':
      return `${label} — failed.`;
    case 'cancelled':
      return `${label} — cancelled.`;
    case 'interrupted':
      return `${label} — interrupted; it will pick up where it left off.`;
  }
}

/**
 * PM-20, Sean: "the user should always know: current stage; current mode;
 * current action; whether it is only reasoning or actually executing; which
 * tools are being used; what changed; what the next best action is."
 */
export function TransparencyPanel({
  run,
  step,
  next,
  stageLabel,
  mode,
  thinking,
}: {
  run: AgentRun | null;
  step: AgentStep | null;
  next: string;
  stageLabel: string;
  mode: string;
  thinking: boolean;
}) {
  const rows: [string, React.ReactNode][] = [
    ['Stage', stageLabel],
    ['Mode', MODE_DISPLAY[mode as ModeType]?.display_name ?? mode ?? '—'],
    ['Action', thinking ? 'Choosing the next move…' : step ? actionLabel(step.action_key) : '—'],
    [
      'Analyzed or performed',
      step?.execution_label ? (
        <ExecutionBadge label={step.execution_label} />
      ) : step?.status === 'running' ? (
        'In progress'
      ) : (
        '—'
      ),
    ],
    ['Tools', step?.tools_used?.length ? step.tools_used.map((t) => (t === 'sandbox' ? 'code sandbox' : t)).join(', ') : '—'],
    ['Status', run ? `${RUN_STATUS[run.status]}${step ? ` · step ${STEP_STATUS[step.status].toLowerCase()}` : ''}` : 'Not started'],
    ['What changed', step && step.status !== 'running' ? changed(step) : '—'],
    ['Next', next],
  ];
  return (
    <section aria-label="What Go mode is doing" className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p role="status" data-narrative className="text-body text-[var(--on-surface)]">
        {narrative(run, step, next, thinking)}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">Execution record</summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-label text-[var(--on-surface-variant)]">{k}</dt>
            <dd className="text-body text-[var(--on-surface)]" data-field={k}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      </details>
      {run?.stop_reason && run.status !== 'running' && (
        <p role="status" className="mt-3 text-body text-[var(--on-surface)]">
          {run.stop_reason}
        </p>
      )}
    </section>
  );
}
