/**
 * What a folder or project inherits from the folders above it (Sean, 23 Nov,
 * "Inheritance & exceptions"). Pure.
 *
 * "A folder should be able to show what it inherits, where it came from, and
 * what's different here. A more specific folder can replace a default when the
 * user has permission. A required rule should only change through an explicit
 * exception by someone authorized to make it ... A newer note or a deeper
 * folder shouldn't silently win."
 *
 * So:
 *   - every current rule of every folder in the chain applies below it;
 *   - a default is replaced only by a rule (or a project fact) that points at
 *     it, made in the chain below the default's own folder. Saying something
 *     different without pointing at it replaces nothing;
 *   - a required rule is never replaced here (the database refuses the
 *     pointer, and one made before the rule became required stops counting);
 *   - a pointer made in a folder outside this chain does nothing. That is how
 *     the other search, and every new one, keeps the client's default.
 */
import type { FolderConflict, FolderDocument, FolderException, FolderFact, FolderKind, ProjectFact, ProjectFolder } from '@/types/project';

/** One folder on the way down, top first. `depth` 0 is the top. */
export interface FolderLevel {
  id: string;
  name: string;
  kind: FolderKind | null;
  depth: number;
}

/** What replaces a default here. `at` null: the project itself. */
export interface Replacement {
  id: string;
  statement: string;
  at: FolderLevel | null;
  /** The default was changed at its own folder after it was replaced here. */
  defaultChanged: boolean;
}

/** A current rule of a folder in the chain, and whether it is replaced here. */
export interface RuleAtLevel {
  fact: FolderFact;
  level: FolderLevel;
  replacedBy: Replacement | null;
  /** It replaces this default of a folder above it. */
  replaces: { fact: FolderFact; level: FolderLevel } | null;
  /** An exception recorded here sets it aside. */
  exceptedBy: AppliedException | null;
}

/** An exception that applies here: recorded in a folder of the chain, or for the project (`at` null). */
export interface AppliedException {
  exception: FolderException;
  at: FolderLevel | null;
  /** The rule was changed at its own folder after the exception was recorded. */
  ruleChanged: boolean;
}

/**
 * A rule handed down and something said lower down that cannot both hold, and
 * nothing the user did has settled it (Sean, 23 Nov: "surface both").
 */
export interface OpenMismatch {
  conflict: FolderConflict;
  upper: RuleAtLevel;
  lower: { kind: 'folder'; rule: RuleAtLevel } | { kind: 'project'; fact: ProjectFact };
}

/** A replacement that no longer counts, and why. */
export interface IgnoredReplacement {
  id: string;
  statement: string;
  at: FolderLevel | null;
  why: 'now_required' | 'outside_chain' | 'gone';
}

export interface Inherited {
  /** The folders from the top down to the place itself (a project's own folder is its last). */
  chain: FolderLevel[];
  /** Every current rule along the chain, top first. */
  rules: RuleAtLevel[];
  /** Those in force here: not replaced. */
  inForce: RuleAtLevel[];
  /** The current documents along the chain, the place's own folder first. */
  documents: { doc: FolderDocument; level: FolderLevel }[];
  ignored: IgnoredReplacement[];
  /** The exceptions that apply here, each with the rule it sets aside. */
  exceptions: (AppliedException & { rule: RuleAtLevel })[];
  /** The mismatches still waiting on the user here. */
  mismatches: OpenMismatch[];
}

export const NO_INHERITED: Inherited = { chain: [], rules: [], inForce: [], documents: [], ignored: [], exceptions: [], mismatches: [] };

/** The folders from the top down to `folderId`, inclusive. Empty for Unfiled or a folder that is gone. */
export function folderChain(folders: readonly Pick<ProjectFolder, 'id' | 'parent_id' | 'name' | 'kind'>[], folderId: string | null | undefined): FolderLevel[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const up: Pick<ProjectFolder, 'id' | 'parent_id' | 'name' | 'kind'>[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(folderId);
  while (cursor && !seen.has(cursor.id) && up.length < 10) {
    seen.add(cursor.id);
    up.push(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return up.reverse().map((f, depth) => ({ id: f.id, name: f.name, kind: f.kind ?? null, depth }));
}

/** The current row a rule became through its corrections: a replacement follows its default forward. */
function currentOf(id: string, facts: readonly FolderFact[]): { fact: FolderFact; changed: boolean } | null {
  const successor = new Map<string, FolderFact>();
  for (const f of facts) if (f.supersedes) successor.set(f.supersedes, f);
  const byId = new Map(facts.map((f) => [f.id, f]));
  let fact = byId.get(id);
  let changed = false;
  for (let hops = 0; fact && fact.retired_at && hops < 50; hops += 1) {
    const next = successor.get(fact.id);
    if (!next) return null;
    fact = next;
    changed = true;
  }
  return fact && !fact.retired_at ? { fact, changed } : null;
}

export function resolveInherited(input: {
  folders: readonly Pick<ProjectFolder, 'id' | 'parent_id' | 'name' | 'kind'>[];
  /** The project's folder, or the folder being looked at. */
  folderId: string | null | undefined;
  /** Rules of (at least) every folder in the chain, current and retired. */
  facts: readonly FolderFact[];
  documents?: readonly FolderDocument[];
  /** A project's own facts, when the place is a project. */
  projectFacts?: readonly ProjectFact[];
  /** The project, when the place is one: its own exceptions apply. */
  projectId?: string | null;
  /** Current exceptions recorded in the chain's folders or for the project. */
  exceptions?: readonly FolderException[];
  /** Mismatches recorded against the chain's rules. */
  conflicts?: readonly FolderConflict[];
}): Inherited {
  const chain = folderChain(input.folders, input.folderId);
  if (!chain.length) return NO_INHERITED;
  const levelOf = new Map(chain.map((l) => [l.id, l]));
  const inChain = input.facts.filter((f) => levelOf.has(f.folder_id));
  const current = inChain
    .filter((f) => !f.retired_at)
    .sort((a, b) => levelOf.get(a.folder_id)!.depth - levelOf.get(b.folder_id)!.depth || a.created_at.localeCompare(b.created_at));

  const replacedBy = new Map<string, Replacement>();
  const replaces = new Map<string, { fact: FolderFact; level: FolderLevel }>();
  const ignored: IgnoredReplacement[] = [];

  const consider = (pointer: string, by: { id: string; statement: string }, at: FolderLevel | null) => {
    const target = currentOf(pointer, input.facts);
    if (!target) {
      ignored.push({ ...by, at, why: 'gone' });
      return;
    }
    const targetLevel = levelOf.get(target.fact.folder_id);
    // Made below the default's own folder, in this chain; a project is below all of them.
    if (!targetLevel || (at && at.depth <= targetLevel.depth)) {
      ignored.push({ ...by, at, why: 'outside_chain' });
      return;
    }
    if (target.fact.required) {
      ignored.push({ ...by, at, why: 'now_required' });
      return;
    }
    // The deepest replacement wins: the project's own over its folder's.
    const held = replacedBy.get(target.fact.id);
    const depthOf = (l: FolderLevel | null) => (l ? l.depth : Number.MAX_SAFE_INTEGER);
    if (!held || depthOf(at) >= depthOf(held.at)) {
      replacedBy.set(target.fact.id, { id: by.id, statement: by.statement, at, defaultChanged: target.changed });
    }
    if (at) replaces.set(by.id, { fact: target.fact, level: targetLevel });
  };

  for (const f of current) if (f.overrides) consider(f.overrides, f, levelOf.get(f.folder_id)!);
  for (const f of input.projectFacts ?? []) {
    if (!f.retired_at && f.overrides_folder_fact) consider(f.overrides_folder_fact, f, null);
  }

  // Exceptions (Sean, 23 Nov: "Apply exception to this search"): recorded in a
  // folder of this chain below the rule's own, or for this project. One made
  // elsewhere (the other search) does nothing here.
  const exceptedBy = new Map<string, AppliedException>();
  for (const e of input.exceptions ?? []) {
    if (e.retired_at) continue;
    const at = e.folder_id ? levelOf.get(e.folder_id) : null;
    if (e.folder_id ? !at : !input.projectId || e.project_id !== input.projectId) continue;
    const target = currentOf(e.rule_id, input.facts);
    const ruleLevel = target ? levelOf.get(target.fact.folder_id) : undefined;
    if (!target || !ruleLevel || (at && at.depth <= ruleLevel.depth)) continue;
    const held = exceptedBy.get(target.fact.id);
    const depthOf = (l: FolderLevel | null | undefined) => (l ? l.depth : Number.MAX_SAFE_INTEGER);
    if (!held || depthOf(at) >= depthOf(held.at)) exceptedBy.set(target.fact.id, { exception: e, at: at ?? null, ruleChanged: target.changed });
  }

  const rules: RuleAtLevel[] = current.map((fact) => ({
    fact,
    level: levelOf.get(fact.folder_id)!,
    replacedBy: replacedBy.get(fact.id) ?? null,
    replaces: replaces.get(fact.id) ?? null,
    exceptedBy: exceptedBy.get(fact.id) ?? null,
  }));
  const documents = (input.documents ?? [])
    .filter((d) => !d.retired_at && levelOf.has(d.folder_id))
    .map((doc) => ({ doc, level: levelOf.get(doc.folder_id)! }))
    .sort((a, b) => b.level.depth - a.level.depth || a.doc.created_at.localeCompare(b.doc.created_at));

  // Open mismatches: both sides still current here, not dismissed, and nothing
  // the user did links them (an exception to the rule here, or the lower side
  // replacing it). Worked out, never stored, so every screen reads the same.
  const ruleById = new Map(rules.map((r) => [r.fact.id, r]));
  const projectFactById = new Map((input.projectFacts ?? []).filter((f) => !f.retired_at).map((f) => [f.id, f]));
  const mismatches: OpenMismatch[] = [];
  for (const c of input.conflicts ?? []) {
    if (c.dismissed_at) continue;
    const upper = ruleById.get(c.upper_fact_id);
    if (!upper || upper.exceptedBy) continue;
    if (c.lower_folder_fact_id) {
      const lower = ruleById.get(c.lower_folder_fact_id);
      if (!lower || lower.level.depth <= upper.level.depth || lower.fact.overrides === upper.fact.id) continue;
      mismatches.push({ conflict: c, upper, lower: { kind: 'folder', rule: lower } });
    } else if (c.lower_project_fact_id) {
      const fact = projectFactById.get(c.lower_project_fact_id);
      if (!fact || fact.overrides_folder_fact === upper.fact.id) continue;
      mismatches.push({ conflict: c, upper, lower: { kind: 'project', fact } });
    }
  }

  return {
    chain,
    rules,
    inForce: rules.filter((r) => !r.replacedBy && !r.exceptedBy),
    documents,
    ignored,
    exceptions: rules.flatMap((r) => (r.exceptedBy ? [{ ...r.exceptedBy, rule: r }] : [])),
    mismatches,
  };
}

/** What disagrees with a rule here, in words, for a prompt: "…" (said in the search folder "CFO"). */
function otherSide(m: OpenMismatch, of: 'upper' | 'lower'): string {
  if (of === 'lower') return `${m.upper.fact.statement} (set in ${levelWords(m.upper.level)})`;
  return m.lower.kind === 'folder'
    ? `${m.lower.rule.fact.statement} (set in ${levelWords(m.lower.rule.level)})`
    : `${m.lower.fact.statement} (a fact of this project)`;
}

/** The project facts still in a mismatch with a folder's rule, with what they disagree with. */
export function unresolvedProjectFacts(inh: Inherited | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of inh?.mismatches ?? []) if (m.lower.kind === 'project') out.set(m.lower.fact.id, otherSide(m, 'lower'));
  return out;
}

/** Which project fact replaces which folder default here, by project fact id. */
export function projectReplacements(inh: Inherited | null | undefined): Map<string, RuleAtLevel> {
  const out = new Map<string, RuleAtLevel>();
  for (const r of inh?.rules ?? []) if (r.replacedBy && !r.replacedBy.at) out.set(r.replacedBy.id, r);
  return out;
}

/** "the client folder "Acme"": a level in the words prompts are written in. */
export function levelWords(level: Pick<FolderLevel, 'name' | 'kind'>): string {
  const noun = level.kind === 'workspace' ? 'workspace' : level.kind === 'client' ? 'client folder' : level.kind === 'search' ? 'search folder' : 'folder';
  return `the ${noun} "${level.name}"`;
}

/** How many inherited rules one request carries; required rules go first. */
export const MAX_INHERITED_SENT = 100;

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** An inherited rule as a request carries it (`AcceptedFact` on the backend). */
export interface InheritedFactPayload {
  statement: string;
  subject: string;
  kind: 'fact' | 'requirement';
  source: string;
  scope: string;
  required?: boolean;
  replaces_default?: string;
  exception?: string;
  unresolved_with?: string;
}

/** The rules in force here, for a request: required first, then from the nearest folder up; at most `MAX_INHERITED_SENT`. */
export function inheritedForRequest(inh: Inherited | null | undefined): { facts: InheritedFactPayload[]; notSent: number } {
  const inForce = inh?.inForce ?? [];
  // Each side of a mismatch still open is sent with the other: neither is relied on (Sean, 23 Nov).
  const unresolved = new Map<string, string>();
  for (const m of inh?.mismatches ?? []) {
    unresolved.set(m.upper.fact.id, [unresolved.get(m.upper.fact.id), otherSide(m, 'upper')].filter(Boolean).join('; and '));
    if (m.lower.kind === 'folder') unresolved.set(m.lower.rule.fact.id, otherSide(m, 'lower'));
  }
  const ordered = [...inForce].sort(
    (a, b) => Number(b.fact.required) - Number(a.fact.required) || b.level.depth - a.level.depth || a.fact.created_at.localeCompare(b.fact.created_at)
  );
  const exceptions: InheritedFactPayload[] = (inh?.exceptions ?? []).map(({ exception: e, at, rule }) => {
    const where = at ? levelWords(at) : 'this project';
    const when = day(e.created_at);
    return {
      statement: e.statement,
      subject: rule.fact.subject ?? '',
      kind: rule.fact.kind,
      source: `an exception recorded for ${where}${when ? `, ${when}` : ''}`,
      scope: where,
      exception: `authorised by ${e.authorised_by}, confirmed ${e.how_confirmed}, because ${e.reason}. It sets aside here the ${rule.fact.required ? 'required ' : ''}rule "${rule.fact.statement}" of ${levelWords(rule.level)}, which still holds everywhere else`,
    };
  });
  const sent = ordered.slice(0, Math.max(0, MAX_INHERITED_SENT - exceptions.length));
  return {
    notSent: ordered.length - sent.length,
    facts: [
      ...exceptions,
      ...sent.map((r) => {
        const when = day(r.fact.created_at);
        const other = unresolved.get(r.fact.id);
        return {
          statement: r.fact.statement,
          subject: r.fact.subject ?? '',
          kind: r.fact.kind,
          source: `from ${levelWords(r.level)}${when ? `, ${when}` : ''}`,
          scope: levelWords(r.level),
          ...(r.fact.required ? { required: true } : {}),
          ...(r.replaces ? { replaces_default: `${r.replaces.fact.statement} (the default of ${levelWords(r.replaces.level)})` } : {}),
          ...(other ? { unresolved_with: other } : {}),
        };
      }),
    ],
  };
}

/** The documents along the chain added after the project's own material, each under a heading naming its folder. */
export function materialWithInherited(context: string, inh: Inherited | null | undefined): string {
  const docs = inh?.documents ?? [];
  if (!docs.length) return context;
  const parts = docs.map(({ doc, level }) => `### From ${doc.name} (${levelWords(level)})\n\n${doc.text.trim()}`);
  return [context.trim(), ...parts].filter(Boolean).join('\n\n');
}

/** The summary line counts: how many come from each folder above, and how many differ here. */
export function inheritedCounts(inh: Inherited | null | undefined): { from: { level: FolderLevel; count: number }[]; differentHere: number; documents: number } {
  const from = new Map<string, { level: FolderLevel; count: number }>();
  for (const r of inh?.inForce ?? []) {
    const held = from.get(r.level.id) ?? { level: r.level, count: 0 };
    held.count += 1;
    from.set(r.level.id, held);
  }
  return {
    from: [...from.values()].sort((a, b) => a.level.depth - b.level.depth),
    differentHere: (inh?.rules ?? []).filter((r) => r.replacedBy && !r.replacedBy.at).length,
    documents: inh?.documents.length ?? 0,
  };
}
