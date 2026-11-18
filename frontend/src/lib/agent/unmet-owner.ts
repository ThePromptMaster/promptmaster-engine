/**
 * Which stage an item the objective check found unmet is about (18 Nov, hand
 * pass). The check reads the deliverable, but what it lists can be another
 * stage's: a board memo after the paper measured over its one page. Carried
 * into the paper, that rewrote its chapters twice and the memo was never
 * shortened. Decided in code, never by a model: the "<stage>: …" a failed check
 * is sent to the check as, or the count a stage's own failed measurement gave,
 * quoted in the item.
 */
import type { Measurement } from '@/lib/workflow/measurable';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

export interface UnmetElsewhere {
  item: string;
  stage_id: string;
}

/** The stage an unmet item names as its own, or null when it is the judged text's. */
export function unmetOwner(
  template: Pick<WorkflowTemplate, 'stages'>,
  measured: Readonly<Record<string, readonly Measurement[]>>,
  item: string
): string | null {
  const text = item.trim().toLowerCase();
  if (!text) return null;
  // `failedChecks` sends each one as "<stage label>: …".
  const byLabel = [...template.stages]
    .sort((a, b) => b.label.length - a.label.length)
    .find((s) => s.label.trim() && text.startsWith(`${s.label.trim().toLowerCase()}:`));
  if (byLabel) return byLabel.id;
  // The check's own words for a failure counted on a stage quote that count.
  for (const [id, ms] of Object.entries(measured)) {
    const quoted = ms.some((m) => {
      const detail = (m.detail ?? '').trim().toLowerCase();
      return !m.satisfied && detail.length >= 12 && text.includes(detail);
    });
    if (quoted) return id;
  }
  return null;
}

/** The unmet items that belong to a stage other than the one the check read, each with that stage. */
export function unmetElsewhere(
  template: Pick<WorkflowTemplate, 'stages'>,
  measured: Readonly<Record<string, readonly Measurement[]>>,
  judgedId: string | null | undefined,
  items: readonly string[]
): UnmetElsewhere[] {
  return items.flatMap((item) => {
    const owner = unmetOwner(template, measured, item);
    return owner && owner !== judgedId ? [{ item, stage_id: owner }] : [];
  });
}

/** What of the unmet list is the judged text's own: everything another stage does not hold. */
export function unmetOfJudged(items: readonly string[], elsewhere: readonly UnmetElsewhere[]): string[] {
  const theirs = new Set(elsewhere.map((e) => e.item));
  return items.filter((i) => !theirs.has(i));
}

/** The one stage every unmet item belongs to, when that is not the stage the check read. */
export function ownerOfAll(items: readonly string[], elsewhere: readonly UnmetElsewhere[]): string | null {
  if (!items.length || unmetOfJudged(items, elsewhere).length) return null;
  const ids = new Set(elsewhere.map((e) => e.stage_id));
  return ids.size === 1 ? elsewhere[0].stage_id : null;
}

const REDO = /^\s*(?:revise|trim|shorten|cut|condense|tighten|edit|fix|correct|update|amend|rewrite|reduce|redo|redraft|rework|reword|polish|adjust|shrink)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The written stage a next task would only redo (18 Nov, hand pass: the check's
 * next task "Trim board memo to one page" was added as a stage of its own beside
 * the memo). Its title or work starts with a revision verb and names a stage
 * that has text, by its label or short label. Null when it is new work.
 */
export function redoesStage(
  template: Pick<WorkflowTemplate, 'stages'>,
  written: ReadonlySet<string>,
  title: string,
  work: string
): StageDefinition | null {
  if (!REDO.test(title) && !REDO.test(work)) return null;
  const text = `${title}\n${work.slice(0, 600)}`.toLowerCase();
  const names = template.stages
    .filter((s) => written.has(s.id))
    .flatMap((s) => [s.label, s.short_label]
      .filter((n): n is string => typeof n === 'string' && n.trim().length >= 4)
      .map((n) => ({ s, n: n.trim().toLowerCase() })))
    .sort((a, b) => b.n.length - a.n.length);
  return names.find(({ n }) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(n)}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text))?.s ?? null;
}
