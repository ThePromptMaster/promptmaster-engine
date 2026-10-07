'use client';

import { useState } from 'react';

import { api } from '@/lib/api/client';
import { publishUserTemplate } from '@/lib/supabase/workflow';
import { templateFromDesign, type DesignedKind, type DesignedWorkflow } from '@/lib/workflow/custom';
import { validateTemplate } from '@/lib/workflow/validate';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { LimitCounter } from '@/components/shared/limit-counter';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

const KIND_WORDS: Record<DesignedKind, string> = { write: 'Writing', list: 'List', check: 'Check' };

/**
 * "Is it going to be able to create the stages as it goes… designing itself?"
 * (3 Oct call). For work the built-in workflows do not fit: describe it,
 * PromptMaster proposes the stages, the user edits them, and the result is
 * saved as the user's own workflow — offered again for every new project.
 */
export function CustomWorkflowDesigner({
  objective,
  ownerId,
  onPublished,
}: {
  objective: string;
  ownerId: string | null;
  onPublished: (template: WorkflowTemplate & { id: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [design, setDesign] = useState<DesignedWorkflow | null>(null);
  const [busy, setBusy] = useState<null | 'design' | 'save'>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const propose = async () => {
    setBusy('design');
    setErrors([]);
    try {
      const { workflow } = await api.generateWorkflow({ description: description.trim(), objective });
      setDesign(workflow);
    } catch (e) {
      setErrors([e instanceof Error && e.message ? e.message : 'Could not design a workflow. Try again.']);
    } finally {
      setBusy(null);
    }
  };

  const edit = (i: number, patch: Partial<DesignedWorkflow['stages'][number]>) =>
    setDesign((d) => (d ? { ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const move = (i: number, by: -1 | 1) =>
    setDesign((d) => {
      if (!d) return d;
      const stages = [...d.stages];
      const [s] = stages.splice(i, 1);
      stages.splice(i + by, 0, s);
      return { ...d, stages };
    });
  const remove = (i: number) => setDesign((d) => (d ? { ...d, stages: d.stages.filter((_, j) => j !== i) } : d));

  const save = async () => {
    if (!design || !ownerId) return;
    const template = templateFromDesign(design, crypto.randomUUID().replace(/-/g, '').slice(0, 10));
    const problems = validateTemplate(template);
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setBusy('save');
    setErrors([]);
    try {
      onPublished(await publishUserTemplate(template, ownerId));
      setOpen(false);
      setDesign(null);
    } catch (e) {
      setErrors([e instanceof Error && e.message ? e.message : 'Could not save the workflow.']);
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 text-body text-[var(--pm-primary)] hover:underline"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">auto_awesome</span>
        None of these fits? Design a workflow for this work
      </button>
    );
  }

  const field = 'w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';

  return (
    <section aria-label="Design a workflow" className="mt-4 rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
      <h3 className="text-title text-[var(--on-surface)]">Design a workflow</h3>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        Say what kind of work this is. PromptMaster proposes the stages an expert would go through; change any of them,
        then save it as your own workflow to use again.
      </p>
      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Multi-line: a description can be a whole workflow brief (6 Oct, email 12). */}
          <AutoGrowTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, INPUT_LIMITS.message))}
            rows={1}
            aria-label="What kind of work is this?"
            placeholder="e.g. a magazine feature, a grant proposal, a client pitch — or paste the whole workflow you have in mind"
            className={`${field} resize-none`}
          />
          <LimitCounter length={description.length} limit={INPUT_LIMITS.message} />
        </div>
        <button
          onClick={() => void propose()}
          disabled={description.trim().length < 3 || busy !== null}
          className="shrink-0 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40"
        >
          {busy === 'design' ? 'Designing…' : design ? 'Design again' : 'Design it'}
        </button>
      </div>

      {design && (
        <div className="mt-5">
          <label className="block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            Name
            <input value={design.name} onChange={(e) => setDesign({ ...design, name: e.target.value })} className={`${field} mt-1 normal-case tracking-normal`} />
          </label>
          <ol aria-label="Proposed stages" className="mt-4 space-y-2">
            {design.stages.map((s, i) => (
              <li key={i} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-label text-[var(--on-surface-variant)]">{i + 1}</span>
                  <input
                    value={s.label}
                    onChange={(e) => edit(i, { label: e.target.value, short_label: e.target.value.slice(0, 20) })}
                    aria-label={`Name of stage ${i + 1}`}
                    className="min-w-0 flex-1 bg-transparent text-body font-semibold text-[var(--on-surface)] outline-none"
                  />
                  <span className="rounded-md bg-[var(--surface-container-high)] px-1.5 py-0.5 text-label text-[var(--on-surface-variant)]">{KIND_WORDS[s.kind]}</span>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move stage ${i + 1} up`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">arrow_upward</button>
                  <button onClick={() => move(i, 1)} disabled={i === design.stages.length - 1} aria-label={`Move stage ${i + 1} down`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">arrow_downward</button>
                  <button onClick={() => remove(i)} disabled={design.stages.length <= 2} aria-label={`Remove stage ${i + 1}`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">close</button>
                </div>
                {s.purpose && <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">{s.purpose}</p>}
                {s.approval && (
                  <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">
                    {s.approval_kind === 'routine' ? 'Checked, and routine: ' : 'You approve: '}“{s.approval}”
                  </p>
                )}
                {s.decision && <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">You decide: “{s.decision}”</p>}
              </li>
            ))}
          </ol>
          <button
            onClick={() => void save()}
            disabled={busy !== null || !ownerId}
            className="mt-4 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40"
          >
            {busy === 'save' ? 'Saving…' : 'Use this workflow'}
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 text-label text-[var(--pm-error)]">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </section>
  );
}
