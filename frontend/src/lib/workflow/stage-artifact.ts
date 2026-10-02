/**
 * Structured stage artifacts: JSON inside ArtifactVersion.content.
 *
 * A list stage's items and a review stage's rows do NOT get their own table.
 * They serialise to JSON in the column that already exists, which means
 * versioning a list is versioning its JSON — restore, provenance and the
 * immutability trigger all keep working for free, and a claim table gets the
 * same history a chapter does. The only thing this gives up is querying
 * *inside* items, which nothing does.
 *
 * Everything here is pure. The parse is deliberately forgiving: a version
 * written by an older build, or hand-edited, must render as an empty list a
 * user can fix, never as a thrown exception inside a renderer.
 */

import type { StageDefinition, StageRenderer } from './types';

/** One row. Fields beyond id/status/reason are declared by the item schema. */
export interface StageItem {
  id: string;
  /** Review rows only. The triage state; absent means untriaged. */
  status?: string;
  /** Review rows only. Required by some statuses — see ReviewStatus.requiresReason. */
  reason?: string;
  [key: string]: string | undefined;
}

export interface StageItemsDocument {
  kind: 'stage_items';
  items: StageItem[];
}

export interface ItemFieldSpec {
  key: string;
  label: string;
  /** Told to the model, and shown as placeholder text to the user. */
  hint?: string;
  /** A long field renders as a textarea; a short one as an input. */
  long?: boolean;
  max?: number;
  /** The values the field may take; told to the model, and what Go's triage reads risk from (B3). */
  options?: readonly string[];
  /**
   * Only the user fills it; the model is never asked for it and a value it
   * offers is dropped. A DOI is the case: a model asked for one will write one.
   */
  userOnly?: boolean;
}

export interface ReviewStatusOption {
  value: string;
  label: string;
  /** 'accepted' reads as done, 'warn' as outstanding, 'neutral' as neither. */
  tone: 'done' | 'warn' | 'neutral';
  /** Dismissing something must cost a sentence; accepting it need not. */
  requiresReason?: boolean;
  /**
   * A provenance state PromptMaster sets, not a decision the user made: the
   * row still counts as undecided (C3). The user replaces it with a decision.
   */
  decided?: false;
  /** Only a tool can set it — never offered in the dropdown. */
  settable?: false;
  /**
   * The model may set it when the project already tells it the outcome — a
   * run that could not be executed because the data was never provided.
   * Statuses without this are not the model's to claim.
   */
  modelMaySet?: true;
  /** The state every generated row starts in. */
  modelDefault?: true;
  /** One line for the legend under the table. */
  explain?: string;
}

export interface StageItemSchema {
  /** Singular noun, used in prompts and in "Add another ___". */
  itemLabel: string;
  fields: ItemFieldSpec[];
  minItems: number;
  maxItems: number;
  /** Present for review stages: the per-row triage enum. */
  statuses?: ReviewStatusOption[];
  /**
   * Said above the rows while any of them is still in the model's default
   * state: what that state means for how far the rows can be trusted.
   * `{n}` and `{total}` are filled in.
   */
  defaultStateNote?: string;
  /**
   * The rows name things a public index can be searched for. `field` is what
   * is searched by; a found record sets `status`, fills `linkField` if it is
   * empty, and writes what was found into `recordField`.
   */
  lookup?: {
    field: string; linkField: string; recordField: string; status: string;
    /** What is looked up, plural: "works", "sources". */
    noun: string;
    /** A row in this status names nothing to search for (a claim with no source found). */
    skipStatus?: string;
    /** The rows are works, so a topic search may add the records it finds as new rows. */
    search?: true;
    /** Said of what was not found, when "misremembered" is not the likely reason. */
    notFoundNote?: string;
  };
  /**
   * The rows are things to be carried out, and a sandbox run that executed
   * can settle one: it sets `status` and writes what the run printed into
   * `field`. Never the model's to set (see `modelMaySet`).
   */
  /**
   * Fields of the row that may already say why, in order of preference. When
   * the user picks a status that needs a reason and has given none, the first
   * that has text is offered as the reason, so nothing is typed twice.
   */
  reasonFrom?: string[];
  execution?: {
    status: string; field: string;
    /** The status of a row whose run could not be made for want of data; it takes the reason the run gave. */
    blocked?: string;
    /** Fields the draft filled in about a run it could not make; emptied when a run settles the row, because they are no longer true. */
    clears?: string[];
  };
}

// --- the registry -----------------------------------------------------------
//
// Keyed by ARTIFACT KIND, not by workflow. Book's `claim_table` and Research's
// reproduction table are the same shape and share one entry; adding a workflow
// adds data here, never a branch in a component. A kind with no entry falls
// back to a single free-text field, so a template can name an artifact this
// build has never heard of and still render.

/**
 * B3: a machine-readable severity, so Go can tell a routine finding from one
 * that changes the work. "major" is the line: structure, argument or promise.
 */
const SEVERITY_VALUES = ['minor', 'moderate', 'major'] as const;
const SEVERITY_HINT = "One of: minor, moderate, major. 'major' means fixing it changes the structure, the argument or a promise made to the reader";

const TRIAGE: ReviewStatusOption[] = [
  { value: 'accepted', label: 'Accept', tone: 'done' },
  { value: 'deferred', label: 'Defer', tone: 'neutral', requiresReason: true },
  { value: 'rejected', label: 'Reject', tone: 'warn', requiresReason: true },
];

const GENERIC_ITEM: StageItemSchema = {
  itemLabel: 'item',
  fields: [{ key: 'text', label: 'Item', long: true, max: 600 }],
  minItems: 1,
  maxItems: 12,
};

export const ITEM_SCHEMAS: Record<string, StageItemSchema> = {
  audience_profile: {
    itemLabel: 'audience segment',
    minItems: 2,
    maxItems: 4,
    fields: [
      { key: 'who', label: 'Who they are', hint: 'One concrete group, not "everyone"', max: 160 },
      { key: 'prior_knowledge', label: 'What they already know', long: true, max: 400 },
      { key: 'what_they_want', label: 'What they want from this', long: true, max: 400 },
    ],
  },

  research_notes: {
    itemLabel: 'claim',
    minItems: 3,
    maxItems: 12,
    fields: [
      { key: 'claim', label: 'Claim', long: true, max: 400 },
      { key: 'source', label: 'Where it comes from', hint: 'A citation, or "assumption"', max: 240 },
      { key: 'confidence', label: 'How sure you are', max: 120 },
    ],
  },

  literature_map: {
    itemLabel: 'work',
    minItems: 3,
    maxItems: 15,
    fields: [
      { key: 'work', label: 'The work', hint: 'Named specifically enough to find again', max: 240 },
      { key: 'finding', label: 'What it established', long: true, max: 400 },
      {
        key: 'relation',
        label: 'How it bears on this question',
        hint: 'Supports, contradicts, neighbours, or supplies the method',
        long: true,
        max: 400,
      },
      { key: 'link', label: 'DOI or link', hint: 'Where you found it — add this when you verify the work yourself', max: 300, userOnly: true },
      { key: 'record', label: 'Record found', hint: 'Filled in when the work is looked up — the title, authors and year the index holds', max: 500, userOnly: true },
    ],
    // 1 Oct, item 12: eleven works recalled from the model's knowledge met
    // "at least three works" and looked exactly like eleven sources. Who
    // established that the work exists is now on the row. "Retrieved" is a
    // search tool's to set: the OpenAlex lookup and topic search (lib/workflow/lookup.ts).
    statuses: [
      {
        value: 'candidate', label: 'Suggested by PromptMaster — not retrieved', tone: 'neutral', decided: false, modelDefault: true,
        explain: 'Recalled from the model\'s knowledge. Nothing was searched or fetched; it may be misremembered or not exist.',
      },
      {
        value: 'retrieved', label: 'Retrieved by PromptMaster', tone: 'done', settable: false,
        explain: 'A record with this title was found in OpenAlex, and its DOI and real title are on the row. Nobody has checked that it says what this row claims.',
      },
      { value: 'verified', label: 'Verified by me', tone: 'done', explain: 'You found the work and checked it says this. Add its DOI or link.' },
    ],
    defaultStateNote:
      '{n} of {total} works were suggested from the model\'s knowledge. They have not been searched for, retrieved or verified — treat them as candidates.',
    lookup: { field: 'work', linkField: 'link', recordField: 'record', status: 'retrieved', noun: 'works', search: true },
  },

  // Keyed 'hypotheses' because that is the artifact kind the Research template
  // declares. The registry is keyed by kind, so a near-miss here silently
  // demotes the stage to a single free-text field.
  hypotheses: {
    itemLabel: 'hypothesis',
    minItems: 1,
    maxItems: 6,
    fields: [
      { key: 'statement', label: 'Statement', long: true, max: 400 },
      { key: 'prediction', label: 'What it predicts', long: true, max: 400 },
      {
        key: 'disconfirming_observation',
        label: 'What would show it false',
        hint: 'A hypothesis nothing could falsify is not one',
        long: true,
        max: 400,
      },
    ],
  },

  claim_table: {
    itemLabel: 'claim',
    minItems: 3,
    maxItems: 20,
    fields: [
      { key: 'claim', label: 'Claim', long: true, max: 400 },
      { key: 'source', label: 'Source', max: 240 },
      { key: 'where', label: 'Where it appears', max: 160 },
      { key: 'record', label: 'Record found', hint: 'Filled in when the source is looked up — the title, authors and year the index holds', max: 500, userOnly: true },
      { key: 'link', label: 'DOI or link', hint: 'Filled in when the source is looked up', max: 300, userOnly: true },
    ],
    // C3 (Sean, 28 Sep, item 12: "If I personally click Verified, what am I
    // representing?"): who established what is on the row. PromptMaster's
    // states are provenance, not decisions — a candidate source, or none —
    // and the row stays undecided until the author verifies it themselves,
    // marks it unverifiable (an acceptable answer; unexamined is not) or
    // removes it. "Verified by PromptMaster" exists for a source-checking
    // tool to set; none is connected, so nothing carries it today.
    statuses: [
      {
        value: 'verified_by_promptmaster', label: 'Verified by PromptMaster', tone: 'done', settable: false,
        explain: 'A tool read the source and confirmed the claim. The lookup only finds that a source exists — it does not read it — so no claim carries this today.',
      },
      {
        value: 'source_found', label: 'Source found by PromptMaster — check it says this', tone: 'neutral', decided: false, settable: false,
        explain: 'A record with the named source\'s title was found in OpenAlex, and its DOI is on the row. Nobody has checked the claim against it; you decide.',
      },
      {
        value: 'candidate_source', label: 'Candidate source — verify it yourself', tone: 'neutral', decided: false,
        explain: 'PromptMaster named where this could be checked. It has not checked it; you decide.',
      },
      {
        value: 'no_source', label: 'No source found', tone: 'neutral', decided: false,
        explain: 'PromptMaster could not name where to check this. Verify it yourself, mark it unverifiable, or remove it.',
      },
      { value: 'verified', label: 'Verified by me', tone: 'done', explain: 'You checked the source yourself.' },
      { value: 'unverifiable', label: 'Unverifiable', tone: 'neutral', requiresReason: true, explain: 'No source could settle it, and you say why. An acceptable answer.' },
      { value: 'removed', label: 'Remove', tone: 'warn', requiresReason: true, explain: 'The claim should not stand, and you say why.' },
    ],
    // The source a claim names can be searched for like any work. Finding it
    // is not verifying the claim: the row moves to "source found", which
    // still counts as undecided.
    lookup: {
      field: 'source', linkField: 'link', recordField: 'record', status: 'source_found', noun: 'sources', skipStatus: 'no_source',
      notFoundNote: 'The index holds published research; a guide, a website or the author\'s own data will not be in it, and a source can also be misremembered.',
    },
  },

  runs: {
    itemLabel: 'run',
    minItems: 1,
    maxItems: 20,
    fields: [
      { key: 'run', label: 'What was to be done', long: true, max: 400 },
      { key: 'observed', label: 'What actually happened', long: true, max: 400 },
      { key: 'deviation', label: 'Deviation from the plan', long: true, max: 400 },
    ],
    // A run that was not done is fine; a run that vanishes between the method
    // and the results is not — so "not run" costs a sentence.
    statuses: [
      { value: 'completed', label: 'Completed', tone: 'done' },
      { value: 'deviated', label: 'Deviated', tone: 'neutral', requiresReason: true },
      // The one outcome the draft can know: nothing ran because what it
      // needed was never provided. "Completed" is never the model's to say.
      { value: 'not_run', label: 'Not run', tone: 'warn', requiresReason: true, modelMaySet: true },
    ],
    // …but a run that really executed in the sandbox is.
    execution: { status: 'completed', field: 'observed', blocked: 'not_run', clears: ['deviation'] },
    reasonFrom: ['deviation', 'observed'],
  },

  alternatives: {
    itemLabel: 'alternative explanation',
    minItems: 2,
    maxItems: 12,
    fields: [
      {
        key: 'explanation',
        label: 'The rival explanation',
        hint: 'In the form its own advocate would recognise',
        long: true,
        max: 400,
      },
      { key: 'why_plausible', label: 'What makes it plausible here', long: true, max: 400 },
      { key: 'how_addressed', label: 'What rules it out', long: true, max: 400 },
    ],
    // Left open is an acceptable outcome. Left unmentioned is not, which is
    // why there is no status meaning "not considered".
    statuses: [
      { value: 'ruled_out', label: 'Ruled out', tone: 'done' },
      { value: 'addressed', label: 'Addressed', tone: 'done' },
      { value: 'left_open', label: 'Left open', tone: 'neutral', requiresReason: true },
    ],
  },

  validation_table: {
    itemLabel: 'result',
    minItems: 1,
    maxItems: 20,
    fields: [
      { key: 'result', label: 'The result', hint: "In the analysis's own terms", long: true, max: 400 },
      { key: 'attempt', label: 'What was done to validate it', long: true, max: 400 },
      { key: 'notes', label: 'What came back', long: true, max: 400 },
    ],
    // Not attempted is honest; unexamined is not. There is no status that lets
    // "we did not check" read as "it held".
    statuses: [
      { value: 'reproduced', label: 'Reproduced', tone: 'done' },
      { value: 'not_reproduced', label: 'Not reproduced', tone: 'warn', requiresReason: true },
      { value: 'not_attempted', label: 'Not attempted', tone: 'neutral', requiresReason: true },
    ],
  },

  continuity_findings: {
    itemLabel: 'finding',
    minItems: 1,
    maxItems: 15,
    fields: [
      { key: 'finding', label: 'What is wrong', long: true, max: 400 },
      { key: 'where', label: 'Where', max: 200 },
      { key: 'severity', label: 'Severity', hint: SEVERITY_HINT, options: SEVERITY_VALUES, max: 80 },
    ],
    statuses: TRIAGE,
  },

  critique_report: {
    itemLabel: 'finding',
    minItems: 3,
    maxItems: 12,
    fields: [
      { key: 'finding', label: 'Finding', long: true, max: 400 },
      { key: 'why_it_matters', label: 'Why it matters', long: true, max: 400 },
      { key: 'suggested_change', label: 'Suggested change', long: true, max: 400 },
      { key: 'severity', label: 'Severity', hint: SEVERITY_HINT, options: SEVERITY_VALUES, max: 80 },
    ],
    statuses: TRIAGE,
  },

  final_evaluation: {
    itemLabel: 'open item',
    // Nothing open is the good outcome: an empty table is a valid draft here.
    minItems: 0,
    maxItems: 12,
    fields: [
      { key: 'item', label: 'Item', long: true, max: 400 },
      { key: 'where', label: 'Where it stands', max: 240 },
    ],
    statuses: [
      { value: 'accepted', label: 'Settled', tone: 'done' },
      { value: 'deferred', label: 'Carry forward', tone: 'neutral', requiresReason: true },
    ],
  },
};

/** The primary artifact kind a stage produces, if it declares one. */
export function primaryArtifactKind(stage: StageDefinition): string | null {
  const spec =
    stage.expected_artifacts.find((a) => a.primary) ?? stage.expected_artifacts[0] ?? null;
  return spec?.kind ?? null;
}

/**
 * The item shape for a stage.
 *
 * Review stages always get a status enum even when their kind is unknown,
 * because a review stage without one cannot satisfy `every_item_has_status`
 * and would strand the user.
 */
export function itemSchemaFor(stage: StageDefinition): StageItemSchema {
  const kind = primaryArtifactKind(stage);
  const found = kind ? ITEM_SCHEMAS[kind] : undefined;
  if (found) return found;
  if (effectiveRenderer(stage) === 'review') return { ...GENERIC_ITEM, statuses: TRIAGE };
  return GENERIC_ITEM;
}

// --- serialisation ----------------------------------------------------------

export function serializeItems(items: StageItem[]): string {
  const doc: StageItemsDocument = { kind: 'stage_items', items };
  return JSON.stringify(doc, null, 2);
}

/**
 * Read items back out of a version's content.
 *
 * Returns null — not [] — when the content is not an item document, so callers
 * can tell "a prose version" apart from "a list stage with nothing in it".
 */
export function parseItems(content: string | null | undefined): StageItem[] | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const raw = (parsed as { items?: unknown }).items;
  if (!Array.isArray(raw)) return null;

  const items: StageItem[] = [];
  for (const row of raw) {
    // A malformed row is dropped rather than rendered as `undefined` fields.
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const entry: StageItem = { id: '' };
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      entry[key] = typeof value === 'string' ? value : String(value);
    }
    if (!entry.id) entry.id = newItemId();
    items.push(entry);
  }
  return items;
}

let counter = 0;
/** Stable enough for a React key and a row target; not a security boundary. */
export function newItemId(): string {
  counter += 1;
  return `i${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyItem(schema: StageItemSchema): StageItem {
  const item: StageItem = { id: newItemId() };
  for (const field of schema.fields) item[field.key] = '';
  return item;
}

/** True when a row carries no text in any declared field. */
export function isBlankItem(item: StageItem, schema: StageItemSchema): boolean {
  return schema.fields.every((f) => !(item[f.key] ?? '').trim());
}

export function statusOption(
  schema: StageItemSchema,
  value: string | undefined
): ReviewStatusOption | undefined {
  if (!value) return undefined;
  return schema.statuses?.find((s) => s.value === value);
}

/**
 * A row is triaged when it has a status and, where that status demands one, a
 * reason. "Rejected because" is a decision; "rejected" on its own is a shrug,
 * and six months later nobody can tell them apart.
 */
export function isTriaged(item: StageItem, schema: StageItemSchema): boolean {
  const option = statusOption(schema, item.status);
  if (!option) return false;
  if (option.decided === false) return false;
  if (option.requiresReason) return (item.reason ?? '').trim().length > 0;
  return true;
}

/**
 * The renderer a stage is actually drawn with.
 *
 * A `list` stage that carries an `every_item_has_status` criterion is drawn as
 * `review`, because only the review renderer has a status control and the
 * criterion is otherwise unsatisfiable. Research v1's Experiment and
 * Alternatives stages were authored that way; v2 fixed the template, but
 * published versions are immutable and projects pinned to v1 were stranded at
 * "10 still unresolved" with no way to resolve anything. Decided by the
 * stage's own criteria, never by which workflow it belongs to.
 */
export function effectiveRenderer(stage: StageDefinition): StageRenderer {
  if (
    stage.renderer === 'list' &&
    stage.exit_criteria.some((c) => c.rule?.type === 'every_item_has_status')
  ) {
    return 'review';
  }
  return stage.renderer;
}

/**
 * Whether the model drafts this stage's artifact through the stage renderer.
 *
 * False for a checkpoint stage that produces nothing (Book's Outline approval,
 * whose only job is to confirm the outline) and for stages that draft through
 * their own panel (the outline editor, long-form drafting). A checkpoint used
 * to auto-draft "items", fail with "The draft came back empty", and offer
 * "Draft the items" on a stage with nothing to draft.
 */
/**
 * A list or review stage's rows as text a reader (or the side chat's model)
 * can follow, instead of the JSON the version column holds (C7). Prose
 * content is returned as it is.
 */
export function stageContentForChat(schema: StageItemSchema, content: string | null | undefined): string {
  const items = parseItems(content);
  if (!items) return content ?? '';
  if (items.length === 0) return '';
  return items
    .map((item, i) => {
      const fields = schema.fields
        .map((f) => ({ label: f.label, value: (item[f.key] ?? '').trim() }))
        .filter((f) => f.value)
        .map((f) => `${f.label}: ${f.value}`);
      const status = statusOption(schema, item.status)?.label;
      const reason = (item.reason ?? '').trim();
      return `${i + 1}. ${fields.join(' — ')}${status ? ` [${status}${reason ? `: ${reason}` : ''}]` : ''}`;
    })
    .join('\n');
}

export function stageDrafts(stage: StageDefinition): boolean {
  if (stage.renderer === 'outline' || stage.renderer === 'long_form') return false;
  return stage.expected_artifacts.length > 0;
}

/** Which renderers store their artifact as items rather than as prose. */
export function rendererHoldsItems(renderer: StageRenderer): boolean {
  return renderer === 'list' || renderer === 'review';
}
