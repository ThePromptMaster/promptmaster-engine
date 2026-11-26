/**
 * What a version was made with (Sean, 23 Nov: "From a transcript review or
 * report, the consultant should be able to see the prompt version, source
 * transcript, and requirements applied"). Pure.
 *
 * Written once, when a stage version is saved (`appendStageVersion`), into
 * `artifact_versions.inputs_used`; versions are append-only, so the record is as
 * permanent as the text it describes. `folder_key` names the folders' rules and
 * exceptions in force, by id: a rule added, changed or taken out at a folder is a
 * new key, and work made under an older one may need another look (L-281).
 */
import type { FolderLevel, Inherited } from './inheritance';
import { attachedDocuments, currentFacts } from '@/lib/workflow/facts';
import type { FolderKind, ProjectFact } from '@/types/project';

export interface UsedLevel {
  id: string;
  name: string;
  kind: FolderKind | null;
}

export interface InputsUsed {
  v: 1;
  /** The workflow version the stage belongs to; its instruction is read from the (immutable) template row. */
  template: { id: string; key: string; version: number; name: string } | null;
  stage: { id: string; label: string; instruction: string };
  model: string;
  requirements: {
    /** The folders' rules and exceptions in force, by id; null when there are no folders. */
    folder_key: string | null;
    /** The project's own facts and requirements. */
    project: { id: string; statement: string; kind: 'fact' | 'requirement' }[];
    /** The folders' rules in force; null when the folders could not be read. */
    inherited: { id: string; statement: string; kind: 'fact' | 'requirement'; required: boolean; level: UsedLevel }[] | null;
    exceptions: { id: string; statement: string; rule_id: string; rule: string; authorised_by: string; level: UsedLevel | null }[];
    /** Pairs not chosen between yet: neither side was relied on. */
    unresolved: number;
  };
  /** The documents the material held: the project's own and its folders'. */
  documents: { name: string; level: UsedLevel | null; chars: number }[];
}

const STATEMENT_MAX = 240;
const PROJECT_FACTS_MAX = 60;
const INHERITED_MAX = 100;

const cut = (s: string) => (s.length > STATEMENT_MAX ? `${s.slice(0, STATEMENT_MAX - 1)}…` : s);
const levelOf = (l: Pick<FolderLevel, 'id' | 'name' | 'kind'>): UsedLevel => ({ id: l.id, name: l.name, kind: l.kind });

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * The folders' rules and folder exceptions in force, as one key; null with no
 * folders. Not the project's own replacements: the folder list compares every
 * project in a folder against the same key.
 */
export function folderKey(inh: Inherited | null | undefined): string | null {
  if (!inh?.chain.length) return null;
  const rules = inh.rules.map((r) => r.fact.id).sort();
  const exceptions = inh.exceptions.filter((e) => e.at).map((e) => e.exception.id).sort();
  return `${rules.length}.${exceptions.length}:${fnv([...rules, '|', ...exceptions].join(','))}`;
}

export function buildInputsUsed(input: {
  template: { id: string; key: string; version: number; name: string } | null;
  stage: { id: string; label: string; instruction?: string | null };
  model: string;
  facts: readonly ProjectFact[] | undefined;
  /** Undefined: the folders could not be read. */
  inherited: Inherited | null | undefined;
  /** Whether the project is filed in a folder at all. */
  inFolder: boolean;
  context: string | undefined;
}): InputsUsed {
  const inh = input.inherited;
  const own = currentFacts(input.facts).slice(-PROJECT_FACTS_MAX);
  return {
    v: 1,
    template: input.template,
    stage: { id: input.stage.id, label: input.stage.label, instruction: cut(input.stage.instruction ?? '') },
    model: input.model,
    requirements: {
      folder_key: inh ? folderKey(inh) : null,
      project: own.map((f) => ({ id: f.id, statement: cut(f.statement), kind: f.kind })),
      inherited: input.inFolder && !inh
        ? null
        : (inh?.inForce ?? []).slice(0, INHERITED_MAX).map((r) => ({
            id: r.fact.id, statement: cut(r.fact.statement), kind: r.fact.kind, required: r.fact.required, level: levelOf(r.level),
          })),
      exceptions: (inh?.exceptions ?? []).map(({ exception: e, rule, at }) => ({
        id: e.id, statement: cut(e.statement), rule_id: rule.fact.id, rule: cut(rule.fact.statement), authorised_by: e.authorised_by, level: at ? levelOf(at) : null,
      })),
      unresolved: inh?.mismatches.length ?? 0,
    },
    documents: [
      ...attachedDocuments(input.context).map((d) => ({ name: d.name, level: null, chars: d.text.length })),
      ...(inh?.documents ?? []).map(({ doc, level }) => ({ name: doc.name, level: levelOf(level), chars: doc.text.length })),
    ],
  };
}

/** What changed in the folders' rules since a version was made: by statement, as the user reads it. */
/**
 * The project's own facts that changed since a version was made (26 Nov, L-290): what it
 * used that is no longer current, and what is current that it did not have. For the
 * reader only; the recheck of folder rules reads `changedSince`.
 */
export function projectFactsChangedSince(
  used: InputsUsed | null | undefined,
  facts: readonly ProjectFact[] | undefined
): { added: string[]; removed: string[] } | null {
  if (!used) return null;
  const was = new Set(used.requirements.project.map((f) => f.statement));
  const is = new Set(currentFacts(facts).slice(-PROJECT_FACTS_MAX).map((f) => cut(f.statement)));
  return { added: [...is].filter((x) => !was.has(x)), removed: [...was].filter((x) => !is.has(x)) };
}

export function changedSince(used: InputsUsed | null | undefined, now: Inherited | null | undefined): { added: string[]; removed: string[] } | null {
  const then = used?.requirements.inherited;
  if (!then || !now) return null;
  const was = new Set([...then.map((r) => r.statement), ...used!.requirements.exceptions.map((e) => e.statement)]);
  const is = new Set([...now.inForce.map((r) => cut(r.fact.statement)), ...now.exceptions.map((e) => cut(e.exception.statement))]);
  return { added: [...is].filter((s) => !was.has(s)), removed: [...was].filter((s) => !is.has(s)) };
}
