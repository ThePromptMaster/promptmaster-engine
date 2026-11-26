'use client';

import { useCallback, useMemo } from 'react';

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
}): OutreachContext | null {
  const { template, bundles, project, appendStageVersion } = input;
  const outreachStages = template.stages.filter((s) => s.renderer === 'outreach' && s.outreach);
  const latest = (stageId: string) => bundles[stageId]?.versions.at(-1)?.content ?? null;
  const parts: OutreachContext['parts'] = {};
  for (const s of outreachStages) parts[s.outreach!.part] = { stageId: s.id, content: latest(s.id) };
  const first = outreachStages[0] ? template.stages.indexOf(outreachStages[0]) : -1;
  const briefStage = first > 0 ? template.stages[first - 1] : null;
  const briefText = briefStage ? latest(briefStage.id) ?? '' : '';
  const partsKey = JSON.stringify(parts);

  const save = useCallback(
    async (stageId: string, content: string, operation: string, summary: string) => {
      if (!appendStageVersion) throw new Error('This stage cannot be saved here.');
      const stage = template.stages.find((s) => s.id === stageId);
      await appendStageVersion(stageId, stage?.label ?? stageId, {
        content,
        source_operation: operation,
        model: project.model,
        mode: project.mode,
        change_summary: summary,
      });
    },
    [appendStageVersion, template.stages, project.model, project.mode]
  );

  return useMemo(
    () => (outreachStages.length ? { project, parts: JSON.parse(partsKey) as OutreachContext['parts'], briefText, save } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outreachStages.length, project, partsKey, briefText, save]
  );
}
