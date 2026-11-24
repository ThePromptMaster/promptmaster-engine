/**
 * Workflows copied into folders, and what their masters changed since (Sean, 23
 * Nov: "Copy and edit templates at any level. Show which version a copy came
 * from. If the master changes later, show what changed and let the team choose
 * whether to apply it to an active search."). Pure.
 *
 * A copy is its own key. Editing it, or taking its master's changes into it,
 * makes the next version of that key; projects pinned to the copy are then
 * offered the new version on their own page, and move only on the user's press.
 *
 * Taking a master's changes is a stage-by-stage merge, field by field, against
 * the version the copy was made from: what the copy left alone takes the
 * master's change; what only the copy changed stays the copy's; where both
 * changed the same field the copy's edit is kept and said.
 */
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

/** The fields of a stage a copy may differ in, compared one by one. */
const FIELDS = ['label', 'short_label', 'entry_guidance', 'entry_prompt_hint', 'renderer', 'exit_criteria', 'required', 'recommended_modes', 'expected_artifacts', 'assess'] as const;
type Field = (typeof FIELDS)[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A copy of `template` under a new key, version 1. */
export function copyOf(template: WorkflowTemplate, key: string): WorkflowTemplate {
  return { ...structuredClone(template), key, version: 1 };
}

/** The next version of a copy with one stage's wording changed. */
export function withStageEdit(
  template: WorkflowTemplate,
  stageId: string,
  edit: Partial<Pick<StageDefinition, 'label' | 'entry_prompt_hint' | 'entry_guidance'>>
): WorkflowTemplate {
  return {
    ...structuredClone(template),
    version: template.version + 1,
    stages: template.stages.map((s) => (s.id === stageId ? { ...structuredClone(s), ...edit } : structuredClone(s))),
  };
}

export interface StageChange {
  stageId: string;
  label: string;
  kind: 'added' | 'removed' | 'changed';
  /** For a changed stage: each field that changed, with its words before and after where it has words. */
  fields: { field: Field; before?: string; after?: string }[];
}

/**
 * The part of a text that changed, with the words either side cut to an ellipsis
 * (24 Nov pass: an instruction whose master added a sentence at the end showed the
 * same first 200 characters on both sides, so nothing seemed to change).
 */
export function changedPart(before: string, after: string, max = 200): { before: string; after: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  // Whole words: a cut inside a word moves to the word's edge.
  const word = (c: string | undefined) => c !== undefined && /\S/.test(c);
  while (start > 0 && word(before[start - 1]) && (word(before[start]) || word(after[start]))) start--;
  while (end > 0 && word(before[before.length - end]) && (word(before[before.length - end - 1]) || word(after[after.length - end - 1]))) end--;
  const cut = (text: string) => {
    const mid = text.slice(start, text.length - end).trim();
    const body = mid.length > max ? `${mid.slice(0, max - 1).trimEnd()}…` : mid;
    return body ? `${start > 0 ? '…' : ''}${body}${end > 0 ? '…' : ''}` : '';
  };
  return { before: cut(before), after: cut(after) };
}

/** What changed from one version of a workflow to another, stage by stage, wording included. */
export function masterChanges(from: WorkflowTemplate, to: WorkflowTemplate): StageChange[] {
  const before = new Map(from.stages.map((s) => [s.id, s]));
  const after = new Map(to.stages.map((s) => [s.id, s]));
  const out: StageChange[] = [];
  for (const s of to.stages) {
    const b = before.get(s.id);
    if (!b) {
      out.push({ stageId: s.id, label: s.label, kind: 'added', fields: [] });
      continue;
    }
    const fields = FIELDS.filter((f) => !same(b[f], s[f])).map((f) => ({
      field: f,
      ...(typeof b[f] === 'string' || typeof s[f] === 'string' ? { before: String(b[f] ?? ''), after: String(s[f] ?? '') } : {}),
    }));
    if (fields.length) out.push({ stageId: s.id, label: s.label, kind: 'changed', fields });
  }
  for (const s of from.stages) if (!after.has(s.id)) out.push({ stageId: s.id, label: s.label, kind: 'removed', fields: [] });
  return out;
}

export interface MergeResult {
  template: WorkflowTemplate;
  /** Fields both the copy and the master changed: the copy's edit was kept. */
  keptOurs: { stageId: string; label: string; field: Field }[];
}

/**
 * The master's changes since `base` taken into `ours` (the copy's latest), as
 * the copy's next version. Stage order follows the master, with stages only the
 * copy added kept after the stage they followed.
 */
export function mergeFromMaster(base: WorkflowTemplate, ours: WorkflowTemplate, theirs: WorkflowTemplate): MergeResult {
  const baseById = new Map(base.stages.map((s) => [s.id, s]));
  const oursById = new Map(ours.stages.map((s) => [s.id, s]));
  const keptOurs: MergeResult['keptOurs'] = [];
  const merged: StageDefinition[] = [];

  for (const t of theirs.stages) {
    const o = oursById.get(t.id);
    const b = baseById.get(t.id);
    if (!o) {
      // In the master, not in the copy: new in the master, or taken out of the copy on purpose.
      if (!b) merged.push(structuredClone(t));
      continue;
    }
    if (!b) {
      merged.push(structuredClone(o));
      continue;
    }
    const stage = structuredClone(o) as StageDefinition & Record<string, unknown>;
    for (const f of FIELDS) {
      if (same(o[f], b[f])) {
        if (t[f] === undefined) delete stage[f];
        else stage[f] = structuredClone(t[f]) as never;
      } else if (!same(t[f], b[f]) && !same(t[f], o[f])) {
        keptOurs.push({ stageId: t.id, label: o.label, field: f });
      }
    }
    merged.push(stage);
  }
  // Stages the master no longer has: dropped unless the copy changed them.
  // Stages only the copy has: kept, after the stage they followed in the copy.
  ours.stages.forEach((o, i) => {
    if (merged.some((m) => m.id === o.id) || theirs.stages.some((t) => t.id === o.id)) return;
    const b = baseById.get(o.id);
    if (b && FIELDS.every((f) => same(o[f], b[f]))) return;
    const prev = ours.stages[i - 1]?.id;
    const at = prev ? merged.findIndex((m) => m.id === prev) : -1;
    merged.splice(at + 1, 0, structuredClone(o));
  });

  // The order may have changed: each stage moves on to the next one, and points back only at stages still there.
  const ids = new Set(merged.map((s) => s.id));
  const relinked = merged.map((s, i) => {
    const next = merged[i + 1]?.id ?? null;
    const transitions = { ...s.transitions };
    transitions.default_next = next;
    if (transitions.loop_to && !ids.has(transitions.loop_to)) delete transitions.loop_to;
    if (transitions.allow_return_to) transitions.allow_return_to = transitions.allow_return_to.filter((id) => ids.has(id));
    return { ...s, transitions };
  });

  return {
    template: { ...structuredClone(ours), version: ours.version + 1, stages: relinked },
    keptOurs,
  };
}
