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
}

export interface ReviewStatusOption {
  value: string;
  label: string;
  /** 'accepted' reads as done, 'warn' as outstanding, 'neutral' as neither. */
  tone: 'done' | 'warn' | 'neutral';
  /** Dismissing something must cost a sentence; accepting it need not. */
  requiresReason?: boolean;
}

export interface StageItemSchema {
  /** Singular noun, used in prompts and in "Add another ___". */
  itemLabel: string;
  fields: ItemFieldSpec[];
  minItems: number;
  maxItems: number;
  /** Present for review stages: the per-row triage enum. */
  statuses?: ReviewStatusOption[];
}

// --- the registry -----------------------------------------------------------
//
// Keyed by ARTIFACT KIND, not by workflow. Book's `claim_table` and Research's
// reproduction table are the same shape and share one entry; adding a workflow
// adds data here, never a branch in a component. A kind with no entry falls
// back to a single free-text field, so a template can name an artifact this
// build has never heard of and still render.

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
    ],
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
    ],
    // Unverifiable is an acceptable answer; unexamined is not — so there is no
    // "skip" here, only outcomes.
    statuses: [
      { value: 'verified', label: 'Verified', tone: 'done' },
      { value: 'unverifiable', label: 'Unverifiable', tone: 'neutral', requiresReason: true },
      { value: 'removed', label: 'Remove', tone: 'warn', requiresReason: true },
    ],
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
      { value: 'not_run', label: 'Not run', tone: 'warn', requiresReason: true },
    ],
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
      { key: 'severity', label: 'Severity', max: 80 },
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
    ],
    statuses: TRIAGE,
  },

  final_evaluation: {
    itemLabel: 'open item',
    minItems: 1,
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
  if (stage.renderer === 'review') return { ...GENERIC_ITEM, statuses: TRIAGE };
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
  if (option.requiresReason) return (item.reason ?? '').trim().length > 0;
  return true;
}

/** Which renderers store their artifact as items rather than as prose. */
export function rendererHoldsItems(renderer: StageRenderer): boolean {
  return renderer === 'list' || renderer === 'review';
}
