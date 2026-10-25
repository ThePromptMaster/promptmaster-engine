/**
 * What a stage had to work with at a given moment. Pure.
 *
 * Recorded when a stage is marked stuck, so that later the project can be
 * asked a plain question: has anything changed since? "Continue the stage
 * and resume" cleared the block whatever the answer, Go took one step and
 * stopped for the same reason, and the button had implied the blocker was
 * gone (2 Oct, item 9). With this the card can say "nothing has changed" —
 * and offer adding the data, skipping, or an honest retry — or say what did.
 */

export interface StageInputs {
  /** Ids of the project's data files. */
  files: string[];
  /** The stage's head version, or null when nothing is saved there. */
  version: string | null;
  /** The project brief, as one string. */
  brief: string;
  /**
   * The accepted facts (ids) and a digest of the context (25 Oct, Sean: "the
   * system requested outcomes or fields that had effectively already been
   * supplied elsewhere" — adding a fact read as "nothing has changed").
   * Absent on records made before.
   */
  facts?: string[];
  context?: string;
}

/** A short digest of a long text: equal texts, equal digests. */
function digestOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

export interface InputsChange {
  changed: boolean;
  /** What changed, each as a clause that follows "Since then, ". */
  what: string[];
}

export function stageInputs(
  project: {
    objective?: string | null; audience?: string | null; constraints?: string | null; output_format?: string | null; data_files?: readonly { id: string }[];
    facts?: readonly { id: string; retired_at?: string | null }[]; context?: string | null;
  },
  headVersionId: string | null | undefined
): StageInputs {
  return {
    files: (project.data_files ?? []).map((f) => f.id).sort(),
    version: headVersionId ?? null,
    brief: [project.objective, project.audience, project.constraints, project.output_format].map((v) => (v ?? '').trim()).join('␟'),
    facts: (project.facts ?? []).filter((f) => !f.retired_at).map((f) => f.id).sort(),
    context: digestOf((project.context ?? '').trim()),
  };
}

function isInputs(value: unknown): value is StageInputs {
  const v = value as StageInputs | null;
  return Boolean(v) && typeof v === 'object' && Array.isArray(v!.files) && typeof v!.brief === 'string' && (v!.version === null || typeof v!.version === 'string');
}

/**
 * Null when `then` is not a record this function wrote — a stage marked
 * stuck before inputs were recorded. "Unknown" is not "unchanged".
 */
export function inputsChanged(then: unknown, now: StageInputs): InputsChange | null {
  if (!isInputs(then)) return null;
  const what: string[] = [];
  const before = new Set(then.files);
  const after = new Set(now.files);
  const added = now.files.filter((id) => !before.has(id)).length;
  const removed = then.files.filter((id) => !after.has(id)).length;
  if (added) what.push(added === 1 ? 'a data file was added' : `${added} data files were added`);
  if (removed) what.push(removed === 1 ? 'a data file was removed' : `${removed} data files were removed`);
  if (then.version !== now.version) what.push('the work on this stage changed');
  if (then.brief !== now.brief) what.push('the project brief changed');
  if (then.facts && now.facts) {
    const had = new Set(then.facts);
    const newFacts = now.facts.filter((id) => !had.has(id)).length;
    if (newFacts) what.push(newFacts === 1 ? 'a fact was accepted' : `${newFacts} facts were accepted`);
  }
  if (then.context !== undefined && now.context !== undefined && then.context !== now.context) what.push('the project context changed');
  return { changed: what.length > 0, what };
}
