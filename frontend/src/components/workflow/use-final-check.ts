'use client';

/**
 * Runs the final check on a one-stage project's draft (11 Nov): once when the
 * model writes it, one correction when the check finds something, and one check
 * of the correction. The rules are in `lib/workflow/final-check.ts`; this only
 * makes the calls and saves the corrected version.
 *
 * Only a draft this page has just written is checked: the check belongs to the
 * writing of a draft, not to opening a project that already has one.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { checkIssues, hasFinalCheckOfItsOwn, repairInstruction, repairSummary, wantsFinalCheck, type FinalCheckState } from '@/lib/workflow/final-check';
import { generationRequest, inputsFrom } from '@/lib/workflow/stage-requests';
import { modeForStage } from '@/lib/workflow/stage-mode';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { Project } from '@/types/project';

interface Options {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition | undefined;
  bundles: Record<string, StageArtifactBundle>;
  /** The current stage of a project that can still be written to. */
  enabled: boolean;
  /** A draft of this stage is being written by this page right now. */
  writing: boolean;
  appendStageVersion: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
}

export function useFinalCheck({ project, template, state, stage, bundles, enabled, writing, appendStageVersion }: Options): FinalCheckState | null {
  const [result, setResult] = useState<{ stageId: string; state: FinalCheckState } | null>(null);
  /** Versions this page has checked or written itself. */
  const seen = useRef(new Set<string>());
  /** Set while a draft is being written: the head it started from, so only what came after is read. */
  const wrote = useRef<{ from: string | null } | null>(null);
  const running = useRef<AbortController | null>(null);
  const latest = useRef({ project, template, state, bundles, appendStageVersion });
  latest.current = { project, template, state, bundles, appendStageVersion };

  const applies = enabled && Boolean(stage) && hasFinalCheckOfItsOwn(template);
  const head = stage ? bundles[stage.id]?.versions.at(-1) : undefined;

  useEffect(() => {
    if (writing && !wrote.current) wrote.current = { from: head?.id ?? null };
    // Only the start of the writing matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing]);

  // Leaving the page or the stage stops a check under way; its own new version must not.
  useEffect(() => () => { running.current?.abort(); running.current = null; }, [stage?.id]);

  useEffect(() => {
    if (!applies || !stage || writing || !wrote.current || running.current) return;
    if (!head || head.id === wrote.current.from || !wantsFinalCheck(head, seen.current)) return;
    wrote.current = null;
    const known = seen.current;
    known.add(head.id);
    const controller = new AbortController();
    running.current = controller;
    const { signal } = controller;
    const show = (next: FinalCheckState) => {
      if (!signal.aborted) setResult({ stageId: stage.id, state: next });
    };
    const check = async (content: string) => {
      const o = latest.current;
      const found = await api.agentCheckDeliverable(
        { inputs: inputsFrom(o.project), deliverable_label: stage.label, content, accepted: [], model: o.project.model },
        signal
      );
      return checkIssues(found);
    };
    void (async () => {
      show({ status: 'checking' });
      try {
        const issues = await check(head.content);
        if (!issues.length) return show({ status: 'clean' });
        const o = latest.current;
        const instruction = repairInstruction(issues);
        const revised = await api.generateStageArtifact(
          { ...generationRequest(o.project, o.template, o.state, o.bundles, stage, head.content, instruction), web_access: 'off', account_search: 'off' },
          signal
        );
        const content = (revised.content ?? '').trim();
        // A correction that came back empty or cut off is not saved: the issues are shown instead.
        if (!content || revised.finish_reason === 'length' || signal.aborted) return show({ status: 'open', fixed: [], left: issues });
        const created = await o.appendStageVersion(stage.id, stage.label, {
          content,
          source_operation: 'applied_findings',
          base_content: head.content,
          instruction,
          model: revised.model_used || o.project.model,
          mode: modeForStage(o.project, stage),
          change_summary: repairSummary(issues),
          finish_reason: revised.finish_reason ?? 'stop',
        });
        const id = (created as { id?: unknown } | null)?.id;
        if (typeof id === 'string') known.add(id);
        const left = await check(content).catch(() => [] as string[]);
        show(left.length ? { status: 'open', fixed: issues, left } : { status: 'corrected', fixed: issues });
      } catch {
        show({ status: 'failed' });
      } finally {
        if (running.current === controller) running.current = null;
      }
    })();
    // The head's id and the end of the writing are what start it; everything else is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applies, stage?.id, head?.id, writing]);

  return applies && stage && result?.stageId === stage.id ? result.state : null;
}
