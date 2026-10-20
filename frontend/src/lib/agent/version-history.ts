/**
 * The saved versions a check of the work is told about. Pure.
 *
 * 19 Oct (Sean, HARBOR): Go paused saying "Check v18 is not in the project"
 * and asking what accepting "Check v18 f4" had decided. Check had 22 saved
 * versions; the objective check was shown only the latest of each stage, so
 * every row that cited an earlier version pointed at text it never saw.
 *
 * `knownVersions` names every stage and how many versions it holds;
 * `referencedVersions` adds the earlier versions the text cites. A table is
 * given as its rows with their decisions; prose as its text, clipped.
 */
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { parseItems } from '@/lib/workflow/stage-artifact';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/** The history the check is shown, all versions together. */
export const HISTORY_MAX = 12_000;
const PROSE_MAX = 3_000;
const ROW_MAX = 240;

/** Each stage that has saved versions, under its short and full labels, with how many. */
export function knownVersions(template: Pick<WorkflowTemplate, 'stages'>, bundles: Record<string, StageArtifactBundle>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of template.stages) {
    const n = Math.max(0, ...(bundles[s.id]?.versions ?? []).map((v) => v.version_number));
    if (!n) continue;
    out[s.short_label || s.label] = n;
    if (s.label !== s.short_label) out[s.label] = n;
  }
  return out;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rowLine(prefix: string, item: Record<string, string | undefined>): string {
  const field = Object.entries(item).find(([k, v]) => !['id', 'status', 'reason', 'status_source', 'status_history'].includes(k) && (v ?? '').trim());
  const text = (field?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const reason = (item.reason ?? '').replace(/\s+/g, ' ').trim();
  const line = `${prefix} ${item.id}: [${item.status || 'undecided'}] ${text}${reason ? ` — reason: ${reason}` : ''}`;
  return line.length > ROW_MAX ? `${line.slice(0, ROW_MAX - 1)}…` : line;
}

/**
 * The earlier versions `text` cites ("Check v18", "Analysis v8 §6"), newest
 * first, within `HISTORY_MAX`. A version that is its stage's latest is left
 * out: the check already reads it.
 */
export function referencedVersions(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle>,
  text: string,
): string[] {
  const cited: { stageId: string; label: string; n: number }[] = [];
  for (const s of template.stages) {
    const labels = [...new Set([s.short_label, s.label].filter(Boolean))];
    const re = new RegExp(`\\b(?:${labels.map(escape).join('|')})\\s+v(\\d{1,3})\\b`, 'gi');
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (!cited.some((c) => c.stageId === s.id && c.n === n)) cited.push({ stageId: s.id, label: s.short_label || s.label, n });
    }
  }
  const out: string[] = [];
  let used = 0;
  for (const c of cited.sort((a, b) => b.n - a.n)) {
    const versions = bundles[c.stageId]?.versions ?? [];
    const head = versions.at(-1);
    const v = versions.find((x) => x.version_number === c.n);
    if (!v || v.id === head?.id) continue;
    const items = parseItems(v.content);
    const prefix = `${c.label} v${c.n}`;
    const block = items
      ? items.map((i) => rowLine(prefix, i)).join('\n')
      : `${prefix}:\n${(v.content ?? '').trim().slice(0, PROSE_MAX)}`;
    if (used + block.length > HISTORY_MAX) continue;
    out.push(block);
    used += block.length;
  }
  return out;
}
