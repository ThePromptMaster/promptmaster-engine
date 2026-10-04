'use client';

/**
 * Drafting a stage's artifact.
 *
 * "No stage opens blank" is the decision this implements: entering a stage that
 * has nothing starts a draft on its own, so the user always has something to
 * react to rather than a cursor blinking in an empty box.
 *
 * Three properties matter more than the mechanics:
 *
 * - **It never overwrites silently.** Auto-drafting only ever fires into an
 *   empty stage. Replacing existing work is an explicit Regenerate, and the
 *   renderers confirm before calling it with `force`.
 * - **It is interruptible.** An AbortController per run, aborted on Stop and on
 *   unmount, so a draft the user walked away from cannot land on the stage they
 *   moved to.
 * - **It fires once per stage.** Attempts are remembered per stage id, so a
 *   generation that failed or came back empty does not become a retry loop
 *   billing the user on every render.
 * - **Its status belongs to a stage.** "Drafting…" and a failure are reported
 *   only for the stage they are about. One flag for the whole hook showed a
 *   draft in progress on whichever stage was being browsed, and that stage's
 *   Stop aborted the real draft somewhere else (4 Oct).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import {
  localFailure,
  stageFailure,
  type PreservedContext,
  type StageFailure,
} from '@/lib/errors/recovery';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { stageDrafts } from '@/lib/workflow/stage-artifact';
import { generationContent, generationRequest } from '@/lib/workflow/stage-requests';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { Project } from '@/types/project';

interface Options {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition | undefined;
  bundles: Record<string, StageArtifactBundle>;
  /** Browsing an earlier stage must not start work on it. */
  enabled: boolean;
  appendStageVersion: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<unknown>;
}

export { inputsFrom } from '@/lib/workflow/stage-requests';

export function useStageGeneration({
  project,
  template,
  state,
  stage,
  bundles,
  enabled,
  appendStageVersion,
}: Options) {
  /** The stage a draft is running for, if any. */
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ stageId: string; failure: StageFailure } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** The stage the in-flight draft is for. */
  const inFlightFor = useRef<string | null>(null);
  const attempted = useRef<Set<string>>(new Set());

  // Read through a ref inside the callback so a changing bundle map does not
  // re-create `generate` and re-trigger the auto-draft effect below.
  const latest = useRef({ project, template, state, bundles, appendStageVersion });
  latest.current = { project, template, state, bundles, appendStageVersion };

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGeneratingFor(null);
  }, []);

  useEffect(() => cancel, [cancel]);

  // The workflow moved off the stage being drafted — skipped, continued past,
  // gone back from. Its draft is no longer wanted: without this a skipped
  // Research stage finished drafting in the background, billed a model call,
  // and wrote an artifact onto a stage the user had just said they did not need.
  // Browsing another stage does not move the cursor, so it does not cancel.
  const currentStageId = state.current_stage_id;
  // The stage was never drafted, so it is no longer "attempted": coming back
  // to it (a return) drafts it, rather than opening blank with only a menu
  // item to recover it.
  useEffect(() => {
    const left = inFlightFor.current;
    if (abortRef.current && left && left !== currentStageId) {
      cancel();
      attempted.current.delete(left);
    }
  }, [currentStageId, cancel]);

  const generate = useCallback(
    async (target: StageDefinition, options?: { force?: boolean }) => {
      const { project: p, template: t, state: s, bundles: b, appendStageVersion: append } =
        latest.current;

      const bundle = b[target.id];
      const head = bundle?.versions.at(-1)?.content ?? '';
      if (head.trim() && !options?.force) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightFor.current = target.id;
      attempted.current.add(target.id);
      setGeneratingFor(target.id);
      setFailure(null);

      // FR-16: what the user can be told is still there. The version count is
      // the strongest claim available — they can go and click the pills.
      const preserved: PreservedContext = {
        savedVersions: bundle?.versions.length ?? 0,
        label: target.label.toLowerCase(),
      };

      try {
        const response = await api.generateStageArtifact(
          generationRequest(p, t, s, b, target, options?.force ? head : ''),
          controller.signal
        );

        if (controller.signal.aborted) return;

        const content = generationContent(target, response);

        if (!content) {
          // Not a provider failure, so it must not be dressed as one — but it
          // owes the same reassurance, because it raises the same question.
          setFailure({
            stageId: target.id,
            failure: localFailure(
              'The draft came back empty',
              'The model returned nothing usable. Trying again often works, and you can always write it yourself.',
              preserved
            ),
          });
          return;
        }

        await append(target.id, target.label, {
          content,
          source_operation: options?.force ? 'stage_regenerate' : 'stage_draft',
          instruction: target.entry_prompt_hint ?? '',
          model: response.model_used || p.model,
          mode: p.mode,
          change_summary: options?.force ? 'Regenerated draft.' : null,
          finish_reason: response.finish_reason || null,
        });
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
        // Everything goes through stageFailure, including a fetch that never
        // reached the server: it is the only path that guarantees the message
        // says what survived.
        setFailure({ stageId: target.id, failure: stageFailure(err, preserved) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setGeneratingFor(null);
      }
    },
    []
  );

  // Auto-draft on entry. Deliberately narrow: the current stage only, a
  // renderer that generates, nothing already written, and not already tried.
  useEffect(() => {
    if (!enabled || !stage) return;
    if (!stageDrafts(stage)) return;
    if (attempted.current.has(stage.id)) return;

    // Safe to read as authoritative: loadProject sets the project and every
    // stage bundle in one update, and the page renders nothing until it has,
    // so an absent bundle here means the stage genuinely has no artifact
    // rather than that its versions have not arrived.
    const bundle = bundles[stage.id];
    if ((bundle?.versions.at(-1)?.content ?? '').trim()) {
      attempted.current.add(stage.id);
      return;
    }

    void generate(stage);
  }, [enabled, stage, bundles, generate]);

  const regenerate = useCallback(
    (options?: { force?: boolean }) => {
      if (stage) void generate(stage, options);
    },
    [stage, generate]
  );

  // Reported for the stage on screen only.
  const here = stage?.id ?? null;
  const shownFailure = failure && failure.stageId === here ? failure.failure : null;

  return {
    generating: generatingFor !== null && generatingFor === here,
    failure: shownFailure,
    /** The plain string, for surfaces that have not adopted the panel. */
    error: shownFailure?.message ?? null,
    dismissFailure: useCallback(() => setFailure(null), []),
    generate: regenerate,
    cancel,
  };
}
