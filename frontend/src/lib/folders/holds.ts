/**
 * What waits on a mismatch between a folder's rule and something said lower
 * down, and what has been read against the folders' rules (Sean, 23 Nov: "If
 * the two instructions are still in conflict, pause the reference work that
 * depends on the answer and let the rest of the search continue."). Pure.
 *
 * Two kinds of event carry it, both written by the browser:
 *   inherited_checked { rules_fp, fact_ids }: these facts were read against these rules;
 *   inherited_hold { conflict_id, stages?, released? }: these stages wait on that
 *     mismatch (with the stage's own words that show it), or the user released one.
 */
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { MismatchLevel } from '@/lib/workflow/engine';
import type { ProjectFact } from '@/types/project';
import { levelWords, type Inherited, type OpenMismatch, type RuleAtLevel } from './inheritance';

/** The rules a project's own facts are read against: every rule in force here or still in dispute. */
export function rulesToReadAgainst(inh: Inherited | null | undefined): RuleAtLevel[] {
  return (inh?.rules ?? []).filter((r) => !r.replacedBy && !r.exceptedBy);
}

/** A short fingerprint of a set of rules: a new rule, or a changed one, is a new set. */
export function rulesFingerprint(rules: readonly Pick<RuleAtLevel, 'fact'>[]): string {
  const text = rules.map((r) => r.fact.id).sort().join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${rules.length}:${h.toString(16)}`;
}

/** The project's current facts not yet read against this set of rules. */
export function factsToCheck(facts: readonly ProjectFact[] | undefined, events: readonly WorkflowEvent[] | null | undefined, fp: string): ProjectFact[] {
  const done = new Set<string>();
  for (const e of events ?? []) {
    if (e.type !== 'inherited_checked' || e.payload?.rules_fp !== fp) continue;
    const ids = e.payload?.fact_ids;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') done.add(id);
  }
  return (facts ?? []).filter((f) => !f.retired_at && f.statement.trim() && !done.has(f.id) && !f.overrides_folder_fact);
}

export interface HoldRecord {
  conflictId: string;
  /** Null until the stages were read for it. */
  stages: { stage_id: string; quote: string }[] | null;
  released: Set<string>;
}

/** The holds the log records, by mismatch. */
export function holdsFrom(events: readonly WorkflowEvent[] | null | undefined): Map<string, HoldRecord> {
  const out = new Map<string, HoldRecord>();
  for (const e of events ?? []) {
    if (e.type !== 'inherited_hold') continue;
    const id = typeof e.payload?.conflict_id === 'string' ? e.payload.conflict_id : '';
    if (!id) continue;
    const held = out.get(id) ?? { conflictId: id, stages: null, released: new Set<string>() };
    const stages = e.payload?.stages;
    if (Array.isArray(stages)) {
      held.stages = stages.flatMap((s) =>
        s && typeof s === 'object' && typeof (s as { stage_id?: unknown }).stage_id === 'string'
          ? [{ stage_id: (s as { stage_id: string }).stage_id, quote: String((s as { quote?: unknown }).quote ?? '') }]
          : []
      );
    }
    const released = e.payload?.released;
    if (Array.isArray(released)) for (const r of released) if (typeof r === 'string') held.released.add(r);
    out.set(id, held);
  }
  return out;
}

/** The open mismatches whose stages have not been read yet. */
export function mismatchesToRead(inh: Inherited | null | undefined, events: readonly WorkflowEvent[] | null | undefined): OpenMismatch[] {
  const holds = holdsFrom(events);
  return (inh?.mismatches ?? []).filter((m) => !holds.get(m.conflict.id)?.stages);
}

/** Each stage held by a mismatch still open, with the mismatch and the stage's words that show it. */
export function heldStages(inh: Inherited | null | undefined, events: readonly WorkflowEvent[] | null | undefined): Map<string, { mismatch: OpenMismatch; quote: string }> {
  const holds = holdsFrom(events);
  const out = new Map<string, { mismatch: OpenMismatch; quote: string }>();
  for (const m of inh?.mismatches ?? []) {
    const held = holds.get(m.conflict.id);
    for (const s of held?.stages ?? []) {
      if (held!.released.has(s.stage_id) || out.has(s.stage_id)) continue;
      out.set(s.stage_id, { mismatch: m, quote: s.quote });
    }
  }
  return out;
}

/** Where the lower side was said, in words. */
export function lowerPlace(m: OpenMismatch): string {
  return m.lower.kind === 'folder' ? levelWords(m.lower.rule.level) : 'this project';
}

/** The lower side's statement. */
export function lowerStatement(m: OpenMismatch): string {
  return m.lower.kind === 'folder' ? m.lower.rule.fact.statement : m.lower.fact.statement;
}

/** The open mismatches as outstanding work: they hold the finish, and name what they hold up. */
export function mismatchOutstanding(
  inh: Inherited | null | undefined,
  events: readonly WorkflowEvent[] | null | undefined,
  stageLabel: (id: string) => string
): { conflictId: string; upper: MismatchLevel; rule: string; lower: MismatchLevel | null; note: string; held: string[] }[] {
  const held = heldStages(inh, events);
  return (inh?.mismatches ?? []).map((m) => ({
    conflictId: m.conflict.id,
    upper: { name: m.upper.level.name, kind: m.upper.level.kind },
    rule: m.upper.fact.statement,
    lower: m.lower.kind === 'folder' ? { name: m.lower.rule.level.name, kind: m.lower.rule.level.kind } : null,
    note: lowerStatement(m),
    held: [...held.entries()].filter(([, h]) => h.mismatch.conflict.id === m.conflict.id).map(([id]) => stageLabel(id)),
  }));
}

/** The planner's line for each: it is the user's choice, not a question to word again. */
export function mismatchLines(items: ReturnType<typeof mismatchOutstanding>): string[] {
  const words = (l: MismatchLevel | null) => (l ? levelWords(l) : 'this project');
  return items.map((i) =>
    `Waiting on the user's choice between two instructions: ${words(i.upper)} says "${i.rule}", and ${words(i.lower)} says "${i.note}". The choice is on the page; do not ask it again.${i.held.length ? ` It holds up: ${i.held.join(', ')}; do not draft ${i.held.length === 1 ? 'that stage' : 'those stages'} until it is chosen.` : ''}`
  );
}

/**
 * Every stage still open waits on a choice, and the stage Go is on is finished: there
 * is no other work, so Go stops on the choice itself rather than asking it in words of
 * its own (24 Nov pass: Go asked "who makes the calls?" with "Do whatever is best", which
 * would have handed a required rule to Go). The held stages, in order; empty otherwise.
 */
export function onlyHeldLeft(
  stages: readonly { id: string }[],
  status: (id: string) => string | undefined,
  held: ReadonlyMap<string, unknown>,
  currentStageId: string
): string[] {
  if (!held.size) return [];
  const done = (s: string | undefined) => s === 'complete' || s === 'completed_with_artifact' || s === 'skipped';
  if (!done(status(currentStageId))) return [];
  const open = stages.filter((s) => !done(status(s.id)));
  return open.length && open.every((s) => held.has(s.id)) ? open.map((s) => s.id) : [];
}
