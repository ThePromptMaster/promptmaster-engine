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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api/client';
import { buildStageDigest, type StageArtifactBundle } from '@/lib/workflow/digest';
import {
  itemSchemaFor,
  rendererHoldsItems,
  serializeItems,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { Project } from '@/types/project';
import type { PMInput } from '@/types';

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

function inputsFrom(project: Project): PMInput {
  return {
    objective: project.objective,
    audience: project.audience,
    constraints: project.constraints,
    output_format: project.output_format,
    mode: project.mode,
    custom_name: project.custom_name,
    custom_preamble: project.custom_preamble,
    custom_tone: project.custom_tone,
    session_facts: project.session_facts,
  };
}

export function useStageGeneration({
  project,
  template,
  state,
  stage,
  bundles,
  enabled,
  appendStageVersion,
}: Options) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const attempted = useRef<Set<string>>(new Set());

  // Read through a ref inside the callback so a changing bundle map does not
  // re-create `generate` and re-trigger the auto-draft effect below.
  const latest = useRef({ project, template, state, bundles, appendStageVersion });
  latest.current = { project, template, state, bundles, appendStageVersion };

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
  }, []);

  useEffect(() => cancel, [cancel]);

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
      attempted.current.add(target.id);
      setGenerating(true);
      setError(null);

      const schema = itemSchemaFor(target);
      const wantsItems = rendererHoldsItems(target.renderer);

      try {
        const response = await api.generateStageArtifact(
          {
            inputs: inputsFrom(p),
            stage: {
              id: target.id,
              label: target.label,
              renderer: target.renderer,
              entry_prompt_hint: target.entry_prompt_hint ?? '',
              artifact_kind: target.expected_artifacts[0]?.kind ?? '',
            },
            digest: buildStageDigest(t, s, p, b, target.id),
            item_schema: wantsItems
              ? {
                  item_label: schema.itemLabel,
                  fields: schema.fields.map((f) => ({
                    key: f.key,
                    label: f.label,
                    hint: f.hint,
                  })),
                  min_items: schema.minItems,
                  max_items: schema.maxItems,
                }
              : null,
            existing_content: options?.force ? head : '',
            model: p.model,
          },
          controller.signal
        );

        if (controller.signal.aborted) return;

        const content = wantsItems
          ? serializeItems(response.items as unknown as StageItem[])
          : response.content;

        if (!content.trim() || (wantsItems && response.items.length === 0)) {
          setError('The draft came back empty. Try again, or write it yourself.');
          return;
        }

        await append(target.id, target.label, {
          content,
          source_operation: options?.force ? 'stage_regenerate' : 'stage_draft',
          instruction: target.entry_prompt_hint ?? '',
          model: p.model,
          mode: p.mode,
          change_summary: options?.force ? 'Regenerated draft.' : null,
          finish_reason: response.finish_reason || null,
        });
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not draft this stage. Try again in a moment.'
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setGenerating(false);
      }
    },
    []
  );

  // Auto-draft on entry. Deliberately narrow: the current stage only, a
  // renderer that generates, nothing already written, and not already tried.
  useEffect(() => {
    if (!enabled || !stage) return;
    if (stage.renderer === 'outline' || stage.renderer === 'long_form') return;
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

  return { generating, error, generate: regenerate, cancel };
}
