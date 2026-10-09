'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { publishUserTemplate } from '@/lib/supabase/workflow';
import { templateFromDesign, type DesignedKind, type DesignedStage, type DesignedWorkflow } from '@/lib/workflow/custom';
import { validateTemplate } from '@/lib/workflow/validate';
import type { WorkflowExecution, WorkflowTemplate } from '@/lib/workflow/types';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { LimitCounter } from '@/components/shared/limit-counter';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

const KIND_WORDS: Record<DesignedKind, string> = { write: 'Writing', list: 'List', check: 'Check' };
const MAX_STAGES = 10;

const NEW_STAGE: DesignedStage = {
  label: 'New stage', short_label: 'New stage', kind: 'write', purpose: '', instruction: '',
  required: true, approval: '', approval_kind: 'decision', decision: '', loop_back_to: '',
};

const FINITE: WorkflowExecution = { kind: 'finite', success_criterion: '', stop_conditions: [] };

/**
 * "Is it going to be able to create the stages as it goes… designing itself?"
 * (3 Oct call). For work the built-in workflows do not fit: describe it,
 * PromptMaster proposes the stages, the user edits them, and the result is
 * saved as the user's own workflow — offered again for every new project.
 *
 * 7 Oct (Sean, 6 Oct, email 11: "customization should be PromptMaster's
 * default … We need an obvious 'Add stage' button and direct editing of each
 * stage's name, instructions, type, and approval requirements … request a
 * targeted change conversationally … without regenerating unrelated
 * stages"): every field of every stage is editable here, a stage can be added
 * anywhere, a change can be asked for in words and touches only what it
 * names, and whether the work ends or goes on — and what counts as done — is
 * part of the design.
 */
export function CustomWorkflowDesigner({
  objective,
  ownerId,
  onPublished,
  initial = null,
  startOpen = false,
  initialState = null,
  onStateChange,
}: {
  objective: string;
  ownerId: string | null;
  onPublished: (template: WorkflowTemplate & { id: string }) => void;
  /** A saved workflow to edit a copy of; publishing makes a new one. */
  initial?: DesignedWorkflow | null;
  startOpen?: boolean;
  /** A design kept from an earlier visit, unpublished (U2). */
  initialState?: { open: boolean; description: string; design: DesignedWorkflow | null } | null;
  /** Told of every change, so the page can keep the design between visits. */
  onStateChange?: (state: { open: boolean; description: string; design: DesignedWorkflow | null }) => void;
}) {
  const [open, setOpen] = useState(initialState?.open ?? (startOpen || Boolean(initial)));
  const [description, setDescription] = useState(initialState?.description ?? '');
  const [design, setDesign] = useState<DesignedWorkflow | null>(initialState?.design ?? initial);
  useEffect(() => {
    onStateChange?.({ open, description, design });
  }, [open, description, design, onStateChange]);
  const [editing, setEditing] = useState<number | null>(null);
  const [request, setRequest] = useState('');
  const [revision, setRevision] = useState<{ changes: string[]; unsupported: { request: string; reason: string }[]; note: string } | null>(null);
  const [busy, setBusy] = useState<null | 'design' | 'save' | 'revise'>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const propose = async () => {
    setBusy('design');
    setErrors([]);
    setRevision(null);
    try {
      const { workflow } = await api.generateWorkflow({ description: description.trim(), objective });
      setDesign(workflow);
      setEditing(null);
    } catch (e) {
      setErrors([e instanceof Error && e.message ? e.message : 'Could not design a workflow. Try again.']);
    } finally {
      setBusy(null);
    }
  };

  const revise = async () => {
    if (!design || request.trim().length < 3) return;
    setBusy('revise');
    setErrors([]);
    try {
      const res = await api.reviseWorkflow({ workflow: design, request: request.trim() });
      setDesign(res.workflow);
      setRevision({ changes: res.changes, unsupported: res.unsupported, note: res.note });
      setRequest('');
    } catch (e) {
      setErrors([e instanceof Error && e.message ? e.message : 'Could not make that change. Nothing was changed.']);
    } finally {
      setBusy(null);
    }
  };

  const edit = (i: number, patch: Partial<DesignedStage>) =>
    setDesign((d) => (d ? { ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const move = (i: number, by: -1 | 1) =>
    setDesign((d) => {
      if (!d) return d;
      const stages = [...d.stages];
      const [s] = stages.splice(i, 1);
      stages.splice(i + by, 0, s);
      return { ...d, stages };
    });
  const remove = (i: number) => {
    setDesign((d) => (d ? { ...d, stages: d.stages.filter((_, j) => j !== i) } : d));
    setEditing(null);
  };
  const add = (at: number) => {
    setDesign((d) => {
      if (!d || d.stages.length >= MAX_STAGES) return d;
      const stages = [...d.stages];
      stages.splice(at, 0, { ...NEW_STAGE });
      return { ...d, stages };
    });
    setEditing(at);
  };
  const setExecution = (patch: Partial<WorkflowExecution>) =>
    setDesign((d) => (d ? { ...d, execution: { ...(d.execution ?? FINITE), ...patch } } : d));

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
  const small = 'rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1 text-label text-[var(--on-surface)]';
  const quiet = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';
  const execution = design?.execution ?? FINITE;

  return (
    <section aria-label="Design a workflow" className="mt-4 rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
      <h3 className="text-title text-[var(--on-surface)]">{initial ? `Edit a copy of ${initial.name}` : 'Design a workflow'}</h3>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        Say what kind of work this is. PromptMaster proposes the stages an expert would go through; change any of them —
        add a stage, edit what each one does, or ask for a change in words — then save it as your own workflow to use again.
      </p>
      {!initial && (
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
      )}
      {design && !initial && (
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          &ldquo;Design again&rdquo; replaces every stage. To change one, edit it below or ask for the change.
        </p>
      )}

      {design && (
        <div className="mt-5">
          <label className="block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            Name
            <input value={design.name} onChange={(e) => setDesign({ ...design, name: e.target.value })} className={`${field} mt-1 normal-case tracking-normal`} />
          </label>

          {/* Whether the work ends after one pass, and what counts as done. */}
          <div role="group" aria-label="When this work is done" className="mt-4 rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-label text-[var(--on-surface)]">
              <span className="font-semibold">This work</span>
              <select
                value={execution.kind}
                onChange={(e) => setExecution({ kind: e.target.value as WorkflowExecution['kind'] })}
                aria-label="Finite or ongoing"
                className={small}
              >
                <option value="finite">ends after one pass</option>
                <option value="ongoing">goes on, round after round, until it is done</option>
              </select>
            </div>
            <label className="mt-2 block text-label text-[var(--on-surface-variant)]">
              Done means
              <AutoGrowTextarea
                value={execution.success_criterion}
                onChange={(e) => setExecution({ success_criterion: e.target.value.slice(0, 2_000) })}
                rows={1}
                aria-label="Done means"
                placeholder="What counts as the objective met — reaching the last stage is not it"
                className={`${field} mt-1 resize-none bg-[var(--surface-container-lowest)]`}
              />
            </label>
            <label className="mt-2 block text-label text-[var(--on-surface-variant)]">
              Stop short of it when (one per line)
              <AutoGrowTextarea
                value={execution.stop_conditions.join('\n')}
                onChange={(e) => setExecution({ stop_conditions: e.target.value.split('\n').slice(0, 8) })}
                rows={1}
                aria-label="Stop conditions"
                placeholder="e.g. a concrete blocker; every branch exhausted; a decision only I can make"
                className={`${field} mt-1 resize-none bg-[var(--surface-container-lowest)]`}
              />
            </label>
          </div>

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
                  <button onClick={() => setEditing(editing === i ? null : i)} aria-label={`Edit stage ${i + 1}`} aria-expanded={editing === i} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">edit</button>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move stage ${i + 1} up`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">arrow_upward</button>
                  <button onClick={() => move(i, 1)} disabled={i === design.stages.length - 1} aria-label={`Move stage ${i + 1} down`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">arrow_downward</button>
                  <button onClick={() => remove(i)} disabled={design.stages.length <= 2} aria-label={`Remove stage ${i + 1}`} className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)] disabled:opacity-30">close</button>
                </div>
                {editing === i ? (
                  <div role="group" aria-label={`Stage ${i + 1} details`} className="ml-7 mt-2 grid gap-2">
                    <label className="text-label text-[var(--on-surface-variant)]">
                      Kind
                      <select value={s.kind} onChange={(e) => edit(i, { kind: e.target.value as DesignedKind })} aria-label={`Kind of stage ${i + 1}`} className={`${small} ml-2`}>
                        <option value="write">Writing — a page of prose</option>
                        <option value="list">List — a table of items</option>
                        <option value="check">Check — findings about earlier work</option>
                      </select>
                    </label>
                    <label className="text-label text-[var(--on-surface-variant)]">
                      What it is for
                      <input value={s.purpose} onChange={(e) => edit(i, { purpose: e.target.value.slice(0, 2_000) })} aria-label={`Purpose of stage ${i + 1}`} className={`${field} mt-1 bg-[var(--surface-container-lowest)]`} />
                    </label>
                    <label className="text-label text-[var(--on-surface-variant)]">
                      Instructions — what PromptMaster produces here
                      <AutoGrowTextarea
                        value={s.instruction}
                        onChange={(e) => edit(i, { instruction: e.target.value.slice(0, INPUT_LIMITS.instruction) })}
                        rows={3}
                        aria-label={`Instructions for stage ${i + 1}`}
                        className={`${field} mt-1 resize-none bg-[var(--surface-container-lowest)]`}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-label text-[var(--on-surface)]">
                      <input type="checkbox" checked={s.required} onChange={(e) => edit(i, { required: e.target.checked })} disabled={i === 0 || i === design.stages.length - 1} />
                      Required
                    </label>
                    <label className="text-label text-[var(--on-surface-variant)]">
                      Sign-off, in your words (leave empty for none)
                      <input value={s.approval} onChange={(e) => edit(i, { approval: e.target.value.slice(0, 120) })} aria-label={`Sign-off for stage ${i + 1}`} placeholder="e.g. I approve this analysis plan" className={`${field} mt-1 bg-[var(--surface-container-lowest)]`} />
                    </label>
                    {s.approval.trim() && (
                      <label className="text-label text-[var(--on-surface-variant)]">
                        Who may give it
                        <select value={s.approval_kind ?? 'decision'} onChange={(e) => edit(i, { approval_kind: e.target.value as 'routine' | 'decision' })} aria-label={`Who signs off stage ${i + 1}`} className={`${small} ml-2`}>
                          <option value="decision">Only me — it needs my judgment</option>
                          <option value="routine">Routine — PromptMaster checks it, and may give it when I let it handle routine decisions</option>
                        </select>
                      </label>
                    )}
                    <label className="text-label text-[var(--on-surface-variant)]">
                      A separate decision on new commitments it proposes (leave empty for none)
                      <input value={s.decision ?? ''} onChange={(e) => edit(i, { decision: e.target.value.slice(0, 120) })} aria-label={`Decision for stage ${i + 1}`} className={`${field} mt-1 bg-[var(--surface-container-lowest)]`} />
                    </label>
                    {execution.kind === 'ongoing' && i > 0 && i < design.stages.length - 1 && (
                      <label className="text-label text-[var(--on-surface-variant)]">
                        Closes a round — the next round starts from
                        <select value={s.loop_back_to ?? ''} onChange={(e) => edit(i, { loop_back_to: e.target.value })} aria-label={`Next round of stage ${i + 1}`} className={`${small} ml-2`}>
                          <option value="">— no, this stage does not close a round</option>
                          {design.stages.slice(0, i).map((t) => (
                            <option key={t.label} value={t.label}>{t.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                ) : (
                  <>
                    {s.purpose && <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">{s.purpose}</p>}
                    {s.approval && (
                      <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">
                        {s.approval_kind === 'routine' ? 'Checked, and routine: ' : 'You approve: '}“{s.approval}”
                      </p>
                    )}
                    {s.decision && <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">You decide: “{s.decision}”</p>}
                    {s.loop_back_to && execution.kind === 'ongoing' && (
                      <p className="ml-7 mt-1 text-label text-[var(--on-surface-variant)]">Closes a round; the next starts from “{s.loop_back_to}”.</p>
                    )}
                  </>
                )}
                <button onClick={() => add(i + 1)} disabled={design.stages.length >= MAX_STAGES} className={`${quiet} ml-6 mt-1`} aria-label={`Add a stage after stage ${i + 1}`}>
                  <span aria-hidden className="material-symbols-outlined text-[16px]">add</span>
                  Add stage
                </button>
              </li>
            ))}
          </ol>

          {/* A change in words: only what it names changes (email 11). */}
          <div className="mt-4 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <AutoGrowTextarea
                value={request}
                onChange={(e) => setRequest(e.target.value.slice(0, INPUT_LIMITS.message))}
                rows={1}
                aria-label="Ask for a change"
                placeholder="Ask for a change — e.g. add a verification stage after Analysis"
                className={`${field} resize-none`}
              />
            </div>
            <button
              onClick={() => void revise()}
              disabled={request.trim().length < 3 || busy !== null}
              className="shrink-0 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)] disabled:opacity-40"
            >
              {busy === 'revise' ? 'Changing…' : 'Make the change'}
            </button>
          </div>
          {revision && (
            <div role="status" aria-label="What changed" className="mt-2 text-label text-[var(--on-surface-variant)]">
              {revision.changes.length ? <p>Changed: {revision.changes.join('; ')}. Everything else is as it was.</p> : <p>Nothing was changed.</p>}
              {revision.note && <p>{revision.note}</p>}
              {revision.unsupported.map((u) => (
                <p key={u.request} className="text-[var(--pm-error)]">
                  Not possible: {u.request} — {u.reason}
                </p>
              ))}
            </div>
          )}

          <button
            onClick={() => void save()}
            disabled={busy !== null || !ownerId}
            className="mt-4 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40"
          >
            {busy === 'save' ? 'Saving…' : initial ? 'Save as a new workflow' : 'Use this workflow'}
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
