'use client';

import type { MessageKey } from '@/lib/i18n/messages/en';
import { shownActionLabel } from '@/lib/i18n/go';
import { getLocale, tr } from '@/lib/i18n/store';
import { shownStopReason } from '@/lib/i18n/stop-reasons';
import { shownModeName } from '@/lib/i18n/stage';
import { MODE_DISPLAY } from '@/lib/constants';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ModeType } from '@/types';
import { ExecutionBadge } from './execution-badge';

const EVENTS = new Set(['objective_assessed', 'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked']);

/**
 * What the step changed, in the user's words (C2, PM-12), with the document
 * and the workflow apart (Sean, 10 Oct, email 6.8: "the record said nothing
 * changed in the project … although the interface changed to a finished
 * state"). Either can be empty. In the interface's language (client, 21 Oct).
 */
function changes(step: AgentStep, run: AgentRun | null): { document: string[]; workflow: string[] } {
  const document: string[] = [];
  const workflow: string[] = [];
  const c = step.changes ?? {};
  if (c.event_types?.length) workflow.push(...c.event_types.map((t) => (EVENTS.has(t) ? tr(`rec.event.${t}` as MessageKey) : t.replace(/_/g, ' '))));
  if (c.sandbox_run_id) document.push(tr('rec.codeRun'));
  if (c.sections_written?.length) {
    document.push(tr(step.action_key === 'revise_sections' ? 'rec.sectionsRevised' : 'rec.sectionsDrafted', { count: c.sections_written.length }));
  }
  if (c.items_triaged?.length) workflow.push(tr('rec.findingsDecided', { count: c.items_triaged.length }));
  if (c.source_ids?.length) document.push(tr('rec.sourcesSaved', { count: c.source_ids.length }));
  if (c.version_ids?.length) {
    if (step.action_key === 'evaluate_stage') workflow.push(tr('rec.evaluation'));
    else if (step.action_key === 'generate_outline') document.push(tr('rec.outline'));
    else if (step.action_key === 'apply_findings') document.push(tr('rec.applied'));
    else if (step.action_key === 'draft_stage' || step.action_key === 'revise_stage') document.push(tr('rec.newDraft'));
    else if (!c.sections_written?.length && !c.items_triaged?.length) document.push(tr('rec.versions', { count: c.version_ids.length }));
  } else if ((step.action_key === 'draft_stage' || step.action_key === 'revise_stage') && step.status === 'succeeded') {
    document.push(tr('rec.newDraft'));
  }
  // The step that ended the run changed the run's state, whatever else it did.
  if (run && run.status !== 'running' && run.steps_used > 0 && step.status === 'succeeded' && step.action_key === 'declare_objective_complete') {
    workflow.push(tr(run.status === 'completed' ? 'rec.runFinished' : 'rec.runPaused'));
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
  const { saved, checked } = outcome(step, run);
  return { saved, checked };
}

/** As `outcomeLines`, with whether anything was saved said as a flag, not read back from the words. */
function outcome(step: AgentStep, run: AgentRun | null): { saved: string; checked: string; savedSomething: boolean } {
  const { document } = changes(step, run);
  const out = step.output ?? '';
  const pending = step.status === 'running' || step.status === 'awaiting_decision';
  const saved = pending
    ? '—'
    : document.length
      ? tr('rec.yes', { what: document.join('; ') })
      : step.status === 'failed' || step.status === 'blocked'
        ? tr('rec.no', { why: firstSentence(out) || tr('rec.nothingSaved') })
        : tr('rec.nothingToSave');
  // The step's output is read as Go wrote it (English); only what is shown is translated.
  const checked = step.changes?.event_types?.includes('stage_marked_complete')
    ? tr('rec.passed')
    : /stays reopened until:?\s*([^.]*)/i.test(out)
      ? tr('rec.stillNeeds', { what: out.match(/stays reopened until:?\s*([^.]*)/i)![1] })
      : /stays reopened/i.test(out)
        ? tr('rec.reopened')
        : /couldn't meet the measured requirement|measured in code and not met/i.test(out)
          ? tr('rec.measured')
          : '—';
  return { saved, checked, savedSomething: !pending && document.length > 0 };
}

/** What the step changed in one line, and whether that was nothing. */
function changed(step: AgentStep, run: AgentRun | null): { text: string; nothing: boolean } {
  const { document, workflow } = changes(step, run);
  const parts = [...document, ...workflow];
  return parts.length ? { text: parts.join('; '), nothing: false } : { text: tr('rec.nothingChanged'), nothing: true };
}

/**
 * One sentence on where things stand (C2, Sean 28 Sep item 14: "the state
 * machine is too visible"). The record below keeps every exact label.
 */
function narrative(run: AgentRun | null, step: AgentStep | null, next: string, thinking: boolean, stageName: (id: string) => string): string {
  if (!run) return tr('tp.notStarted');
  if (thinking) return tr('tp.choosing');
  if (!step) return `${tr(`runStatus.${run.status}`)}.`;
  const target = targetOf(step);
  const label = `${shownActionLabel(step.action_key)}${target ? ` (${stageName(target)})` : ''}`;
  switch (step.status) {
    case 'running':
      return tr('tp.n.running', { label });
    case 'awaiting_decision':
      return tr('tp.n.awaiting', { label });
    case 'succeeded': {
      const what = changed(step, run);
      const tail = what.nothing ? tr('tp.n.noChange') : tr('tp.n.changed', { what: what.text });
      return `${tr('tp.n.done', { label })}${tail}${run.status === 'awaiting_decision' ? tr('tp.n.waiting') : run.status === 'running' ? tr('tp.n.next', { next }) : ''}`;
    }
    case 'blocked':
      return tr('tp.n.blocked', { label });
    case 'failed': {
      return outcome(step, run).savedSomething
        ? tr('tp.n.savedNotPassed', { label, why: firstSentence(step.output) })
        : tr('tp.n.notSaved', { label, why: firstSentence(step.output) || tr('tp.n.itFailed') });
    }
    case 'cancelled':
      return tr('tp.n.cancelled', { label });
    case 'interrupted':
      return tr('tp.n.interrupted', { label });
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
  stageModes = 'stage',
  thinking,
  stageName = (id) => id,
  stageByEnglish,
}: {
  /** A stage's English name, as the screen says it: for the names inside a recorded reason. */
  stageByEnglish?: (english: string) => string;
  run: AgentRun | null;
  step: AgentStep | null;
  next: string;
  stageLabel: string;
  mode: string;
  /** The mode the stage recommends, when it differs from the project's (10 Oct, email 3). */
  stageMode?: string;
  /** Whether each stage is worked in its own mode or the project's (13 Oct). */
  stageModes?: 'stage' | 'project';
  thinking: boolean;
  /** A stage's name, for a step that worked on another stage than the one the run is on. */
  stageName?: (id: string) => string;
}) {
  const modeName = (m: string) => shownModeName(m, MODE_DISPLAY[m as ModeType]?.display_name ?? m);
  const changedNow = step && step.status !== 'running' ? changes(step, run) : null;
  const outcome = step ? outcomeLines(step, run) : null;
  const target = step ? targetOf(step) : null;
  // What was used, in the user's words rather than the record's.
  const TOOL_NAME: Record<string, string> = { sandbox: tr('tp.tool.sandbox'), model: tr('tp.tool.model'), jobs: tr('tp.tool.jobs'), search: tr('tp.tool.search') };
  const rows: [string, React.ReactNode][] = [
    ['Stage', target ? tr('tp.workedOn', { stage: stageLabel, other: stageName(target) }) : stageLabel],
    // The project's mode is what every step uses; the stage only recommends one (Sean, 10 Oct:
    // "The execution record lists Clarity, while the stage displays Critic").
    // Which mode this stage's work used, and why (13 Oct, Sean 12.7).
    [
      'Mode',
      !mode
        ? '—'
        : stageMode && stageMode !== mode && mode !== 'custom'
          ? stageModes === 'project'
            ? tr('tp.modeYours', { mode: modeName(mode), stageMode: modeName(stageMode) })
            : tr('tp.modeStage', { stageMode: modeName(stageMode), mode: modeName(mode) })
          : modeName(mode),
    ],
    ['Action', thinking ? tr('tp.choosing') : step ? shownActionLabel(step.action_key) : '—'],
    [
      'Analyzed or performed',
      step?.execution_label ? (
        <ExecutionBadge label={step.execution_label} />
      ) : step?.status === 'running' ? (
        tr('tp.inProgress')
      ) : (
        '—'
      ),
    ],
    ['Tools', step?.tools_used?.length ? step.tools_used.map((t) => TOOL_NAME[t] ?? t).join(', ') : '—'],
    // The run and the step apart (13 Oct: "Could not continue · step done").
    ['Run', run ? tr(`runStatus.${run.status}`) : tr('tp.runNotStarted')],
    ['This step', step ? tr(`stepStatus.${step.status}`) : '—'],
    ['Saved', outcome ? outcome.saved : '—'],
    ['Checked', outcome ? outcome.checked : '—'],
    ['Workflow changes', changedNow ? (changedNow.workflow.join('; ') || tr('tp.none')) : '—'],
    ['Next', next],
  ];
  return (
    <section aria-label={tr('tp.label')} className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p role="status" data-narrative className="text-body text-[var(--on-surface)]">
        {narrative(run, step, next, thinking, stageName)}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">{tr('tp.record')}</summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-label text-[var(--on-surface-variant)]">{tr(`tp.row.${k}` as MessageKey)}</dt>
            <dd className="text-body text-[var(--on-surface)]" data-field={k}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      </details>
      {run?.stop_reason && run.status !== 'running' && (
        <p role="status" className="mt-3 whitespace-pre-line text-body text-[var(--on-surface)]">
          {shownStopReason(getLocale(), run.stop_reason, stageByEnglish)}
        </p>
      )}
    </section>
  );
}
