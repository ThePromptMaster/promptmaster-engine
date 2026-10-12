/**
 * The instructions the user applied to the work since the brief (12 Oct;
 * Sean, Atlas and Meridian).
 *
 * An instruction applied with "Change it" — "the permitted evidence is now
 * S1–S7", "Elena approved removing Supplier" — was saved only on the version
 * it made. No later prompt read it, so the review held the revised report to
 * S1–S5, and Go proposed restoring the rows the user had removed. Every
 * request now carries them (`PMInput.user_instructions`), and the backend's
 * context block ranks them above the brief and the reviewed prompt, below an
 * accepted fact. Pure.
 */

import type { ArtifactVersion, Project } from '@/types/project';
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

/** How a version records an instruction the user wrote and applied themselves. */
const USER_INSTRUCTED: ReadonlySet<string> = new Set(['chat_instruct', 'chat_save']);
/** Not an instruction: what "Save this discussion" records in place of one. */
const NOT_SAID = /^save the discussion as a new version$/i;

const EACH_MAX = 1_500;
const MAX = 12;

export interface AppliedInstruction {
  stage: string;
  version: number;
  instruction: string;
  at: string;
}

function said(v: ArtifactVersion): string {
  if (!USER_INSTRUCTED.has(v.source_operation)) return '';
  const text = (v.instruction ?? '').replace(/\s+/g, ' ').trim();
  if (!text || NOT_SAID.test(text)) return '';
  return text.length > EACH_MAX ? `${text.slice(0, EACH_MAX - 1).trimEnd()}…` : text;
}

/** Every instruction the user applied, oldest first, the latest `MAX`. */
export function appliedInstructions(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): AppliedInstruction[] {
  if (!bundles) return [];
  const out: AppliedInstruction[] = [];
  for (const stage of template.stages) {
    for (const v of bundles[stage.id]?.versions ?? []) {
      const instruction = said(v);
      if (instruction) out.push({ stage: stage.label, version: v.version_number, instruction, at: v.created_at });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX);
}

/** The project as every request is built from it: with the instructions joined on, like its facts. */
export function withAppliedInstructions<P extends Project>(
  project: P,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): P {
  const applied = appliedInstructions(template, bundles);
  return applied.length ? { ...project, applied_instructions: applied } : project;
}
