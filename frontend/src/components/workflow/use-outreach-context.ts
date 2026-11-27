'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { stageHeadVersionId } from '@/lib/supabase/stage-head';
import type { NewVersion } from '@/lib/supabase/versions';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';
import type { OutreachContext } from './renderers/types';

/**
 * The Outreach parts of a workflow, for its renderer (26 Nov): each part's latest content, the
 * brief before them, and a save. Built from the template's data (`stage.outreach.part`), never
 * from which workflow it is. Null when the workflow has no outreach stage.
 */
export function useOutreachContext(input: {
  template: WorkflowTemplate;
  bundles: Record<string, StageArtifactBundle>;
  project: Project;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  /** The stage's head now, from the database (a test passes its own). */
  headOf?: (projectId: string, stageId: string) => Promise<string | null>;
}): OutreachContext | null {
  const { template, bundles, project, appendStageVersion, headOf = stageHeadVersionId } = input;
  const outreachStages = template.stages.filter((s) => s.renderer === 'outreach' && s.outreach);
  const latest = (stageId: string) => bundles[stageId]?.versions.at(-1)?.content ?? null;
  const parts: OutreachContext['parts'] = {};
  for (const s of outreachStages) parts[s.outreach!.part] = { stageId: s.id, content: latest(s.id) };
  const first = outreachStages[0] ? template.stages.indexOf(outreachStages[0]) : -1;
  const briefStage = first > 0 ? template.stages[first - 1] : null;
  const briefText = briefStage ? latest(briefStage.id) ?? '' : '';
  const partsKey = JSON.stringify(parts);

  // Every version of an outreach part this page has seen or saved. Each part saves its whole list,
  // so a save made from an older one would undo what another tab, or another window, did since
  // (27 Nov pass: a set-aside in a stale tab withdrew an approval made in the fresh one).
  const known = useRef(new Set<string>());
  const seenKey = outreachStages.flatMap((s) => (bundles[s.id]?.versions ?? []).map((v) => v.id)).join(',');
  useEffect(() => {
    for (const id of seenKey.split(',')) if (id) known.current.add(id);
  }, [seenKey]);

  const ensureCurrent = useCallback(
    async (stageId: string) => {
      const head = await headOf(project.id, stageId).catch(() => undefined);
      // Unreadable: the save goes ahead, as it did before this check.
      if (head && !known.current.has(head)) throw new Error(STALE_SAVE);
    },
    [headOf, project.id]
  );

  const save = useCallback(
    async (stageId: string, content: string, operation: string, summary: string) => {
      if (!appendStageVersion) throw new Error('This stage cannot be saved here.');
      await ensureCurrent(stageId);
      const stage = template.stages.find((s) => s.id === stageId);
      const created = await appendStageVersion(stageId, stage?.label ?? stageId, {
        content,
        source_operation: operation,
        model: project.model,
        mode: project.mode,
        change_summary: summary,
      });
      const id = (created as { id?: unknown } | null)?.id;
      if (typeof id === 'string') known.current.add(id);
    },
    [appendStageVersion, ensureCurrent, template.stages, project.model, project.mode]
  );

  return useMemo(
    () => (outreachStages.length ? { project, parts: JSON.parse(partsKey) as OutreachContext['parts'], briefText, save, ensureCurrent } : null),
    [outreachStages.length, project, partsKey, briefText, save, ensureCurrent]
  );
}

/** Said when an outreach part was changed elsewhere since this page loaded; nothing is saved. */
export const STALE_SAVE = 'These were changed in another tab or window since this page loaded, so nothing was saved. Reload the page to see the latest, then try again.';
