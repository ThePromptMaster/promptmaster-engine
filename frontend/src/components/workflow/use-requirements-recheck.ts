'use client';

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api/client';
import { changedSince, folderKey } from '@/lib/folders/inputs-used';
import { finishedConclusions } from '@/lib/workflow/brief-change';
import { folderKeysOf, getInputsUsed } from '@/lib/supabase/versions';
import type { NewWorkflowEvent } from '@/lib/supabase/workflow';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { isDone, type WorkflowEvent, type WorkflowState, type WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';

/**
 * Finished work written under folder rules that have changed since (Sean, 23
 * Nov: "If the client adds a required topic halfway through a search, use it for
 * the next review and flag earlier reviews that may need another look. Keep the
 * earlier versions available."; L-281).
 *
 * The next draft uses the new rules by itself: every request carries them. What
 * was finished before is found by the folder key each version recorded. When the
 * project opens, the finished stages whose current version was made under another
 * key are judged against what changed, by the same check a changed fact gets, and
 * one `brief_changed` is recorded for this set of rules. The projection marks the
 * stages it names for a recheck; their versions stay as they were. A second tab
 * writing the same recheck is refused by the database and changes nothing.
 */
export function useRequirementsRecheck(input: {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
  events: readonly WorkflowEvent[] | null;
  stageId: string;
  enabled: boolean;
  appendEvent: (e: NewWorkflowEvent) => Promise<unknown>;
  /** Read the log again: another tab may have written this recheck first. */
  refreshEvents?: () => Promise<unknown>;
}): void {
  const { project, template, state, bundles, events, stageId, enabled, appendEvent, refreshEvents } = input;
  const done = useRef(new Set<string>());
  const inherited = project.inherited;
  const key = folderKey(inherited);

  useEffect(() => {
    if (!enabled || !events || !inherited || !key || done.current.has(key)) return;
    if (events.some((e) => e.type === 'brief_changed' && e.payload?.requirements_key === key)) return;
    const finished = template.stages.filter((s) => isDone(state.stages[s.id]?.status) && bundles[s.id]?.versions.at(-1));
    if (!finished.length) return;
    done.current.add(key);
    void (async () => {
      try {
        const heads = new Map(finished.map((s) => [bundles[s.id]!.versions.at(-1)!.id, s.id]));
        const keys = await folderKeysOf([...heads.keys()]);
        // Only versions that recorded a key, and another one: a version saved before
        // the record existed is not guessed at.
        const older = [...heads].filter(([vid]) => keys.has(vid) && keys.get(vid) !== key);
        if (!older.length) return;
        const used = await getInputsUsed(older.at(-1)![0]);
        const diff = changedSince(used, inherited);
        if (!diff || (!diff.added.length && !diff.removed.length)) return;
        const stageIds = new Set(older.map(([, sid]) => sid));
        const stages = finishedConclusions(template, state, bundles).filter((c) => stageIds.has(c.stage_id));
        const before = diff.removed.map((s) => `- ${s}`).join('\n') || '(nothing)';
        const after = diff.added.map((s) => `- ${s}`).join('\n') || '(nothing)';
        const impact = await api.assessChange({
          field: 'facts', before: `The folders' rules said:\n${before}`, after: `The folders' rules now say:\n${after}`, stages, model: project.model || undefined,
        });
        await appendEvent({
          type: 'brief_changed', stage_id: stageId,
          payload: {
            field: 'facts', kind: impact.kind, presentation_only: false, origin: 'folder', requirements_key: key,
            affected: impact.affected.filter((a) => stageIds.has(a.stage_id)), checked: [...stageIds],
            added: diff.added, removed: diff.removed, calculations_hold: impact.calculations_hold,
          },
        });
      } catch (e) {
        // Recorded by another tab already (23505): read the log, so this tab shows
        // the recheck that tab wrote (24 Nov pass: the second tab still showed the
        // stages as done). Not judged: nothing is marked, and it is looked at
        // again the next time the project opens.
        if ((e as { code?: string } | null)?.code === '23505') await refreshEvents?.().catch(() => undefined);
      }
    })();
  }, [enabled, events, inherited, key, template, state, bundles, project.model, stageId, appendEvent, refreshEvents]);
}
