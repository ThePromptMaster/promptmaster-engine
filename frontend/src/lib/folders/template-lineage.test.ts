import { describe, expect, it } from 'vitest';

import { changedPart, copyOf, masterChanges, mergeFromMaster, withStageEdit } from './template-lineage';
import { validateTemplate } from '@/lib/workflow/validate';
import { SINGLE_OUTPUT_V1 as singleOutputTemplate } from '@/lib/workflow/templates/single-output.v1';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/**
 * Sean, 23 Nov: "Copy and edit templates at any level. Show which version a copy
 * came from. If the master changes later, show what changed and let the team
 * choose whether to apply it to an active search."
 */
const master: WorkflowTemplate = singleOutputTemplate;
const [first, second] = master.stages;

describe('copies of a workflow', () => {
  it('a copy is its own key at version 1 with the same stages', () => {
    const copy = copyOf(master, 'custom_abc');
    expect(copy.key).toBe('custom_abc');
    expect(copy.version).toBe(1);
    expect(copy.stages.map((s) => s.id)).toEqual(master.stages.map((s) => s.id));
    expect(validateTemplate(copy, { requireHints: false, requireAuthority: false })).toEqual([]);
  });

  it('editing a stage makes the next version and leaves the others as they were', () => {
    const copy = copyOf(master, 'custom_abc');
    const next = withStageEdit(copy, second.id, { entry_prompt_hint: 'Cover the notice period in every review.' });
    expect(next.version).toBe(2);
    expect(next.stages[1].entry_prompt_hint).toBe('Cover the notice period in every review.');
    expect(next.stages[0]).toEqual(copy.stages[0]);
  });
});

describe('what the master changed, and taking it into a copy', () => {
  const base = master;
  const theirs: WorkflowTemplate = {
    ...structuredClone(master),
    version: master.version + 1,
    stages: master.stages.map((s) =>
      s.id === first.id ? { ...structuredClone(s), entry_prompt_hint: 'MASTER: state the objective in one line.' }
        : s.id === second.id ? { ...structuredClone(s), entry_prompt_hint: 'MASTER: quote the transcript.' }
          : structuredClone(s)
    ),
  };

  it('says what changed, stage by stage, with the words before and after', () => {
    const changes = masterChanges(base, theirs);
    expect(changes.map((c) => [c.label, c.kind, c.fields.map((f) => f.field)])).toEqual([
      [first.label, 'changed', ['entry_prompt_hint']],
      [second.label, 'changed', ['entry_prompt_hint']],
    ]);
    expect(changes[0].fields[0].after).toBe('MASTER: state the objective in one line.');
  });

  it('takes the master change where the copy left the stage alone, and keeps the copy edit where both changed it', () => {
    const ours = withStageEdit(copyOf(base, 'custom_abc'), second.id, { entry_prompt_hint: 'OURS: cover the notice period.' });
    const merged = mergeFromMaster(base, ours, theirs);
    expect(merged.template.key).toBe('custom_abc');
    expect(merged.template.version).toBe(ours.version + 1);
    expect(merged.template.stages.find((s) => s.id === first.id)?.entry_prompt_hint).toBe('MASTER: state the objective in one line.');
    expect(merged.template.stages.find((s) => s.id === second.id)?.entry_prompt_hint).toBe('OURS: cover the notice period.');
    expect(merged.keptOurs).toEqual([{ stageId: second.id, label: second.label, field: 'entry_prompt_hint' }]);
    expect(validateTemplate(merged.template, { requireHints: false, requireAuthority: false })).toEqual([]);
  });

  it('a stage the master added comes in; one it removed goes unless the copy changed it', () => {
    const added = { ...structuredClone(second), id: 'master_extra', label: 'Master extra' };
    const withAdded: WorkflowTemplate = { ...structuredClone(theirs), stages: [...theirs.stages.slice(0, 2), added, ...theirs.stages.slice(2)] };
    const ours = copyOf(base, 'custom_abc');
    const merged = mergeFromMaster(base, ours, withAdded);
    expect(merged.template.stages.map((s) => s.id)).toContain('master_extra');
    expect(validateTemplate(merged.template, { requireHints: false, requireAuthority: false })).toEqual([]);

    const removedLast: WorkflowTemplate = { ...structuredClone(theirs), stages: theirs.stages.slice(0, -1) };
    expect(mergeFromMaster(base, ours, removedLast).template.stages.map((s) => s.id)).not.toContain(base.stages.at(-1)!.id);
    const edited = withStageEdit(ours, base.stages.at(-1)!.id, { entry_prompt_hint: 'OURS: keep this stage.' });
    expect(mergeFromMaster(base, edited, removedLast).template.stages.map((s) => s.id)).toContain(base.stages.at(-1)!.id);
  });

  it('each stage moves on to the next one after a merge', () => {
    const merged = mergeFromMaster(base, copyOf(base, 'custom_abc'), theirs).template;
    merged.stages.forEach((s, i) => expect(s.transitions.default_next).toBe(merged.stages[i + 1]?.id ?? null));
  });
});

describe('changedPart (24 Nov pass)', () => {
  it('shows a sentence added at the end, not the shared opening', () => {
    const before = 'Read the interview transcript against the topics. Use only the transcript.';
    const after = `${before} Mark any answer that differs from the CV.`;
    expect(changedPart(before, after)).toEqual({ before: '', after: '…Mark any answer that differs from the CV.' });
  });

  it('a word changed in the middle keeps whole words and marks the cuts', () => {
    expect(changedPart('Reports go to the client as PDF every week.', 'Reports go to the client as Word every week.')).toEqual({ before: '…PDF…', after: '…Word…' });
  });

  it('a removed sentence is said as removed text', () => {
    expect(changedPart('One. Two.', 'One.')).toEqual({ before: '…Two.', after: '' });
  });
});
