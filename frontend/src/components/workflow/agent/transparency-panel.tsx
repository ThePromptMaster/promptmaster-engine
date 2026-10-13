'use client';

import { actionLabel } from '@/lib/agent/actions';
import { RUN_STATUS_TEXT as RUN_STATUS, STEP_STATUS_TEXT as STEP_STATUS } from '@/lib/agent/labels';
import { MODE_DISPLAY } from '@/lib/constants';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ModeType } from '@/types';
import { ExecutionBadge } from './execution-badge';

const EVENT_PHRASE: Record<string, string> = {
  objective_assessed: 'an objective check recorded',
  stage_marked_complete: 'a stage marked complete',
  stage_advanced: 'the project moved on, leaving the stage open',
  stage_blocked: 'a stage marked stuck',
  stage_unblocked: 'a stage continued',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the step changed, in the user's words (C2, PM-12), with the document
 * and the workflow apart (Sean, 10 Oct, email 6.8: "the record said nothing
 * changed in the project … although the interface changed to a finished
 * state"). Either can be empty.
 */
function changes(step: AgentStep, run: AgentRun | null): { document: string[]; workflow: string[] } {
  const document: string[] = [];
  const workflow: string[] = [];
  const c = step.changes ?? {};
  if (c.event_types?.length) workflow.push(...c.event_types.map((t) => EVENT_PHRASE[t] ?? t.replace(/_/g, ' ')));
  if (c.sandbox_run_id) document.push('a recorded code run');
  if (c.sections_written?.length) {
    document.push(step.action_key === 'revise_sections' ? `${plural(c.sections_written.length, 'section')} revised` : `${plural(c.sections_written.length, 'section')} drafted`);
  }
  if (c.items_triaged?.length) workflow.push(`${plural(c.items_triaged.length, 'routine finding')} decided`);
  if (c.version_ids?.length) {
    if (step.action_key === 'evaluate_stage') workflow.push('an evaluation of the current version');
    else if (step.action_key === 'generate_outline') document.push('the outline, saved as a version');
    else if (step.action_key === 'apply_findings') document.push('a new version with the findings applied');
    else if (step.action_key === 'draft_stage' || step.action_key === 'revise_stage') document.push('a new version of this draft');
    else if (!c.sections_written?.length && !c.items_triaged?.length) document.push(plural(c.version_ids.length, 'new version'));
  } else if ((step.action_key === 'draft_stage' || step.action_key === 'revise_stage') && step.status === 'succeeded') {
    document.push('a new version of this draft');
  }
  // The step that ended the run changed the run's state, whatever else it did.
  if (run && run.status !== 'running' && run.steps_used > 0 && step.status === 'succeeded' && step.action_key === 'declare_objective_complete') {
    workflow.push(run.status === 'completed' ? 'Go run finished' : 'Go run paused for you');
  }
  return { document, workflow };
}

/** The stage a step worked on, when it is not the one the run stood on: a repair names its target. */
function targetOf(step: AgentStep): string | null {
  const t = (step.params as { stage_id?: unknown } | null)?.stage_id;
  return typeof t === 'string' && t && t !== step.stage_id ? t : null;
}

/** The first sentence of a step's output: why it saved nothing, in its own words. */
function firstSentence(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : t).replace(/[.\s]+$/, '');
  return s.length > 240 ? `${s.slice(0, 237)}…` : s;
}

/**
 * Was it saved, and did it pass its checks — kept apart (13 Oct, Sean:
 * "Repair — done", "Draft written", "Could not continue · step done" and "1
 * new version" in one record, with no way to tell what happened).
 */
export function outcomeLines(step: AgentStep, run: AgentRun | null): { saved: string; checked: string } {
  const { document } = changes(step, run);
  const out = step.output ?? '';
  const saved =
    step.status === 'running' || step.status === 'awaiting_decision'
      ? '—'
      : document.length
        ? `Yes — ${document.join('; ')}`
        : step.status === 'failed' || step.status === 'blocked'
          ? `No — ${firstSentence(out) || 'nothing was saved'}`
          : 'Nothing to save — this step reads or decides';
  const checked = step.changes?.event_types?.includes('stage_marked_complete')
    ? 'Passed — the stage was marked complete'
    : /stays reopened until:?\s*([^.]*)/i.test(out)
      ? `Not yet — still needs: ${out.match(/stays reopened until:?\s*([^.]*)/i)![1]}`
      : /stays reopened/i.test(out)
        ? 'Not passed — the stage stays reopened'
        : /couldn't meet the measured requirement|measured in code and not met/i.test(out)
          ? 'Not passed — a measured requirement is still unmet'
          : '—';
  return { saved, checked };
}

function changed(step: AgentStep, run: AgentRun | null): string {
  const { document, workflow } = changes(step, run);
  const parts = [...document, ...workflow];
  return parts.length ? parts.join('; ') : 'Nothing in the project — this step only produced the text below.';
}

/**
 * One sentence on where things stand (C2, Sean 28 Sep item 14: "the state
 * machine is too visible"). The record below keeps every exact label.
 */
function narrative(run: AgentRun | null, step: AgentStep | null, next: string, thinking: boolean, stageName: (id: string) => string): string {
  if (!run) return 'Go mode has not started.';
  if (thinking) return 'Choosing the next move…';
  if (!step) return `${RUN_STATUS[run.status]}.`;
  const target = targetOf(step);
  const label = `${actionLabel(step.action_key)}${target ? ` (${stageName(target)})` : ''}`;
  switch (step.status) {
    case 'running':
      return `${label} — in progress.`;
    case 'awaiting_decision':
      return `Proposed: ${label}. Waiting for your approval.`;
    case 'succeeded': {
      const what = changed(step, run);
      const tail = what.startsWith('Nothing in the project') ? 'No change to the project.' : `Changed: ${what}.`;
      return `${label} — done. ${tail}${run.status === 'awaiting_decision' ? ' Waiting for you.' : run.status === 'running' ? ` Next: ${next}.` : ''}`;
    }
    case 'blocked':
      return `${label} — could not continue.`;
    case 'failed': {
      const { saved } = outcomeLines(step, run);
      return saved.startsWith('Yes')
        ? `${label} — saved, but it did not pass its check: ${firstSentence(step.output)}.`
        : `${label} — not saved: ${firstSentence(step.output) || 'it failed'}.`;
    }
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
  stageMode,
  thinking,
  stageName = (id) => id,
}: {
  run: AgentRun | null;
  step: AgentStep | null;
  next: string;
  stageLabel: string;
  mode: string;
  /** The mode the stage recommends, when it differs from the project's (10 Oct, email 3). */
  stageMode?: string;
  thinking: boolean;
  /** A stage's name, for a step that worked on another stage than the one the run is on. */
  stageName?: (id: string) => string;
}) {
  const modeName = (m: string) => MODE_DISPLAY[m as ModeType]?.display_name ?? m;
  const changedNow = step && step.status !== 'running' ? changes(step, run) : null;
  const outcome = step ? outcomeLines(step, run) : null;
  const target = step ? targetOf(step) : null;
  // What was used, in the user's words rather than the record's.
  const TOOL_NAME: Record<string, string> = { sandbox: 'code sandbox', model: 'AI model', jobs: 'background writing queue', search: 'literature search (OpenAlex)' };
  const rows: [string, React.ReactNode][] = [
    ['Stage', target ? `${stageLabel} · this step worked on ${stageName(target)}` : stageLabel],
    // The project's mode is what every step uses; the stage only recommends one (Sean, 10 Oct:
    // "The execution record lists Clarity, while the stage displays Critic").
    [
      'Project mode',
      mode
        ? `${modeName(mode)}${stageMode && stageMode !== mode ? ` · this stage suggests ${modeName(stageMode)}; Go uses the project's mode` : ''}`
        : '—',
    ],
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
    ['Tools', step?.tools_used?.length ? step.tools_used.map((t) => TOOL_NAME[t] ?? t).join(', ') : '—'],
    // The run and the step apart (13 Oct: "Could not continue · step done").
    ['Run', run ? RUN_STATUS[run.status] : 'Not started'],
    ['This step', step ? STEP_STATUS[step.status] : '—'],
    ['Saved', outcome ? outcome.saved : '—'],
    ['Checked', outcome ? outcome.checked : '—'],
    ['Workflow changes', changedNow ? (changedNow.workflow.join('; ') || 'None') : '—'],
    ['Next', next],
  ];
  return (
    <section aria-label="What Go mode is doing" className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p role="status" data-narrative className="text-body text-[var(--on-surface)]">
        {narrative(run, step, next, thinking, stageName)}
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
