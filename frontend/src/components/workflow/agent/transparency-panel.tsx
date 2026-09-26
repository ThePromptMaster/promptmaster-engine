'use client';

import { actionLabel } from '@/lib/agent/actions';
import { MODE_DISPLAY } from '@/lib/constants';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ModeType } from '@/types';
import { ExecutionBadge } from './execution-badge';

const RUN_STATUS: Record<AgentRun['status'], string> = {
  running: 'Running',
  awaiting_decision: 'Waiting for you',
  blocked: 'Blocked',
  completed: 'Completed',
  budget_exhausted: 'Budget used up',
  stopped: 'Stopped',
  failed: 'Failed',
};

const STEP_STATUS: Record<AgentStep['status'], string> = {
  running: 'In progress',
  succeeded: 'Done',
  failed: 'Failed',
  blocked: 'Blocked',
  awaiting_decision: 'Waiting for approval',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

function changed(step: AgentStep): string {
  const parts: string[] = [];
  const c = step.changes ?? {};
  if (c.event_types?.length) parts.push(c.event_types.map((t) => t.replace(/_/g, ' ')).join(', '));
  if (c.sandbox_run_id) parts.push('a recorded code run');
  if (step.action_key === 'draft_stage' || step.action_key === 'revise_stage') {
    if (step.status === 'succeeded') parts.push('a new version of this stage');
  }
  if (c.version_ids?.length && step.action_key === 'evaluate_stage') parts.push('an evaluation of the current version');
  return parts.length ? parts.join('; ') : 'Nothing in the project — this step only produced the text below.';
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
      'Reasoned or executed',
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
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-label text-[var(--on-surface-variant)]">{k}</dt>
            <dd className="text-body text-[var(--on-surface)]" data-field={k}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {run?.stop_reason && run.status !== 'running' && (
        <p role="status" className="mt-3 text-body text-[var(--on-surface)]">
          {run.stop_reason}
        </p>
      )}
    </section>
  );
}
