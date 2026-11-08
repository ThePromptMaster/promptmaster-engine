/**
 * What a chapter is written against beside its outline (7 Nov, production).
 *
 * A chapter saw the brief and the outline's one-line abstracts. Regenerating
 * one document of a package produced a schedule that matched neither the Core
 * plan nor the other documents, because the Core plan never reached it. The
 * stages before it that write prose or lists are read when the job runs, so a
 * correction made since the job was queued is what it sees. Pure.
 */

import { documentText } from '@/lib/workflow/digest';
import type { StageDefinition } from '@/lib/workflow/types';

export const GOVERNING_MAX = 12_000;

/** The earlier stages' current text, nearest first for the room there is, in stage order. */
export function governingText(
  stages: readonly StageDefinition[],
  stageId: string,
  contents: Readonly<Record<string, string | null | undefined>>
): string {
  const at = stages.findIndex((s) => s.id === stageId);
  const earlier = stages.slice(0, Math.max(at, 0)).filter((s) => s.renderer === 'prose' || s.renderer === 'list');
  let room = GOVERNING_MAX;
  const blocks: string[] = [];
  for (const stage of [...earlier].reverse()) {
    const text = documentText(stage, contents[stage.id]);
    if (!text || room < 200) continue;
    const kept = text.length > room ? `${text.slice(0, room)}\n[the rest of this stage is left out for length]` : text;
    blocks.unshift(`### ${stage.label}\n${kept}`);
    room -= kept.length;
  }
  return blocks.join('\n\n');
}
