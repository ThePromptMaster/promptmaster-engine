'use client';

/**
 * The original PromptMaster core, inside a stage (PM-10).
 *
 * The retired /session flow had Challenge, Reframe, Self-audit, the Refine
 * family, Drift Alert and Continue Document. Their endpoints, prompt builders
 * and tests all survived the retirement; nothing in the workspace called them.
 * This hook is that call site. Every rewrite lands as a new version with its
 * provenance, and every critique is shown beside the draft rather than
 * replacing it — so nothing here can lose work.
 */

import { useCallback, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { asIteration } from '@/lib/workflow/legacy';
import type { StageDefinition } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { FlowTriggerType } from '@/types';
import type { ArtifactVersion, Project } from '@/types/project';
import { inputsFrom } from './use-stage-generation';

/** Rewrites: the result becomes a new version. */
export const REWRITE_TOOLS = [
  { kind: 'drift_alert', label: 'Realign to the objective', icon: 'my_location' },
  { kind: 'refine_shorter', label: 'Refine: make it shorter', icon: 'compress' },
  { kind: 'refine_concrete', label: 'Refine: more concrete', icon: 'category' },
  { kind: 'refine_technical', label: 'Refine: more technical', icon: 'engineering' },
  { kind: 'refine_cautious', label: 'Refine: more cautious', icon: 'shield' },
  { kind: 'refine_angle', label: 'Refine: a different angle', icon: 'rotate_right' },
] as const satisfies readonly { kind: FlowTriggerType; label: string; icon: string }[];

/** Critiques: commentary about the draft, never a replacement for it. */
export const CRITIQUE_TOOLS = [
  { kind: 'challenge', label: 'Challenge this draft', icon: 'gavel', title: 'The case against this draft' },
  { kind: 'reframe', label: 'Reframe it', icon: 'flip', title: 'Another way to see it' },
  { kind: 'self_audit', label: 'Self-audit (Cold Critic)', icon: 'fact_check', title: 'Cold Critic self-audit' },
] as const satisfies readonly { kind: FlowTriggerType; label: string; icon: string; title: string }[];

export type RewriteKind = (typeof REWRITE_TOOLS)[number]['kind'];
export type CritiqueKind = (typeof CRITIQUE_TOOLS)[number]['kind'];
export type ToolKind = RewriteKind | CritiqueKind | 'continue';

export interface Commentary {
  kind: CritiqueKind;
  title: string;
  text: string;
}

interface Options {
  project: Project;
  stage: StageDefinition | null;
  headVersion: ArtifactVersion | null;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
}

export function useStageTools({ project, stage, headVersion, appendStageVersion }: Options) {
  const [running, setRunning] = useState<ToolKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<Commentary | null>(null);
  const guard = useRef(false);

  const run = useCallback(
    async (kind: ToolKind) => {
      if (!stage || !headVersion || guard.current) return;
      const content = headVersion.content;
      if (!content.trim()) return;

      guard.current = true;
      setRunning(kind);
      setError(null);
      const next = headVersion.version_number + 1;

      try {
        if (kind === 'continue') {
          const { iteration } = await api.continueDocument({
            inputs: inputsFrom(project),
            incomplete_iteration: asIteration(content, headVersion.version_number, project.mode),
            iteration_number: next,
            model: project.model,
          });
          await appendStageVersion?.(stage.id, stage.label, {
            content: iteration.output,
            source_operation: 'continuation',
            instruction: 'Continue from where the draft stopped.',
            model: iteration.model_used || project.model,
            mode: project.mode,
            change_summary: iteration.summary || 'Continued from where the draft was cut off.',
            finish_reason: null,
          });
          return;
        }

        const { iteration } = await api.flowTrigger({
          inputs: inputsFrom(project),
          current_output: content,
          trigger: kind,
          iteration_number: next,
          model: project.model,
        });
        const output = iteration.output.trim();
        if (!output) throw new Error('The model returned nothing usable. Trying again often works.');

        const critique = CRITIQUE_TOOLS.find((t) => t.kind === kind);
        if (critique) {
          setCommentary({ kind: critique.kind, title: critique.title, text: output });
          return;
        }

        const tool = REWRITE_TOOLS.find((t) => t.kind === kind)!;
        await appendStageVersion?.(stage.id, stage.label, {
          content: output,
          source_operation: `flow_${kind}`,
          instruction: tool.label,
          model: iteration.model_used || project.model,
          mode: project.mode,
          change_summary: iteration.summary || tool.label,
        });
      } catch (e) {
        setError(
          `${e instanceof Error && e.message ? e.message : 'That did not work'}. Nothing was changed — your current version is untouched.`
        );
      } finally {
        guard.current = false;
        setRunning(null);
      }
    },
    [stage, headVersion, project, appendStageVersion]
  );

  return {
    run,
    running,
    error,
    commentary,
    dismissCommentary: useCallback(() => setCommentary(null), []),
    dismissError: useCallback(() => setError(null), []),
  };
}
