/**
 * Which version people already received (26 Nov, L-289). Pure.
 *
 * Sean, 25 Nov: "Say a supplier changes a delivery date after the plan has gone
 * out … The user should be able to see what changed, why it changed, and which
 * version people already received." Nothing recorded it: an export only
 * downloaded, and finishing named no version.
 *
 * A `version_shared` event is the user's own record that a stage's version went
 * to someone: to whom, on which day, how, and a note. It is their word; nothing
 * checks it. A later record with `undoes` takes one back, and one with
 * `not_sending` says the readers keep the older version on purpose. The stage's
 * state never reads it (`projectState`); this does, for the version list, the
 * change notice and what is still open.
 */
import type { ArtifactVersion } from '@/types/project';
import type { WorkflowEvent } from './types';

export interface SharedRecord {
  /** This record's own id, so a later one can take it back. */
  recordId: string;
  stageId: string;
  versionId: string;
  versionNumber: number;
  /** Who received it, in the user's words. */
  to: string;
  /** The day it went, YYYY-MM-DD. */
  on: string;
  how?: string;
  note?: string;
  /** The readers keep this older version on purpose (after a newer one was made). */
  notSending?: boolean;
  /** When it was recorded. */
  at: string;
}

export const SHARED_LIMITS = { to: 200, how: 80, note: 500 } as const;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Every record still standing, per stage, oldest first. */
export function sharedVersions(events: readonly WorkflowEvent[]): Record<string, SharedRecord[]> {
  const undone = new Set(
    events
      .filter((e) => e.type === 'version_shared' && typeof e.payload?.undoes === 'string')
      .map((e) => e.payload!.undoes as string)
  );
  const out: Record<string, SharedRecord[]> = {};
  for (const e of events) {
    if (e.type !== 'version_shared' || typeof e.payload?.undoes === 'string') continue;
    const p = e.payload ?? {};
    const recordId = text(p.record_id, 64);
    const versionId = text(p.version_id, 64);
    if (!recordId || !versionId || undone.has(recordId)) continue;
    const rec: SharedRecord = {
      recordId,
      stageId: e.stage_id,
      versionId,
      versionNumber: Number(p.version_number) || 0,
      to: text(p.to, SHARED_LIMITS.to),
      on: text(p.on, 10),
      at: e.created_at,
      ...(text(p.how, SHARED_LIMITS.how) ? { how: text(p.how, SHARED_LIMITS.how) } : {}),
      ...(text(p.note, SHARED_LIMITS.note) ? { note: text(p.note, SHARED_LIMITS.note) } : {}),
      ...(p.not_sending === true ? { notSending: true } : {}),
    };
    (out[e.stage_id] ??= []).push(rec);
  }
  return out;
}

/** The newest version a stage's readers have: the last record that sent one. */
export function lastSent(records: readonly SharedRecord[] | undefined): SharedRecord | null {
  const sent = (records ?? []).filter((r) => !r.notSending);
  return sent.length ? sent.reduce((a, b) => (b.versionNumber > a.versionNumber || (b.versionNumber === a.versionNumber && b.at > a.at) ? b : a)) : null;
}

/** Longest a change line is shown beside who has which version. */
export const CHANGE_LINE_MAX = 220;

/**
 * A version's change note as one line: the change itself, without the notes kept
 * out of the document for the user (26 Nov production pass: a commitment's line ran
 * to a paragraph of "Kept out of the document, for you: …").
 */
export function changeLine(summary: string | null | undefined): string {
  let text = (summary ?? '').replace(/\s+/g, ' ').trim();
  const cut = text.search(/\s*[—-]+\s*Kept out of the document|\s*Notes? for you\b/i);
  if (cut > 0) text = text.slice(0, cut).trim();
  return text.length > CHANGE_LINE_MAX ? `${text.slice(0, CHANGE_LINE_MAX - 1).trimEnd()}…` : text;
}

export interface SentBehind {
  stageId: string;
  sent: SharedRecord;
  /** The stage's current version number. */
  current: number;
  /** What changed after the version they have: each later version's own change note. */
  changes: { version: number; summary: string }[];
}

/**
 * Stages whose readers have an older version than the current one, and have not
 * been told it stays (`not_sending` on the current version or later). In stage order.
 */
export function sentSuperseded(input: {
  events: readonly WorkflowEvent[];
  stageOrder: readonly string[];
  versions: Readonly<Record<string, readonly Pick<ArtifactVersion, 'id' | 'version_number' | 'change_summary'>[]>>;
}): SentBehind[] {
  const shared = sharedVersions(input.events);
  const out: SentBehind[] = [];
  for (const stageId of input.stageOrder) {
    const records = shared[stageId];
    const sent = lastSent(records);
    if (!sent) continue;
    const list = input.versions[stageId] ?? [];
    const current = list.reduce((n, v) => Math.max(n, v.version_number), 0);
    if (!current || current <= sent.versionNumber) continue;
    // "Keep the older version with them", said on the current version or later: nothing to send.
    if ((records ?? []).some((r) => r.notSending && r.versionNumber >= current)) continue;
    const changes = list
      .filter((v) => v.version_number > sent.versionNumber)
      .sort((a, b) => a.version_number - b.version_number)
      .map((v) => ({ version: v.version_number, summary: changeLine(v.change_summary) }))
      .filter((c) => c.summary);
    out.push({ stageId, sent, current, changes });
  }
  return out;
}

/** A new record's payload. */
export function sharedPayload(input: {
  recordId: string;
  versionId: string;
  versionNumber: number;
  to: string;
  on: string;
  how?: string;
  note?: string;
  notSending?: boolean;
}): Record<string, unknown> {
  return {
    record_id: input.recordId,
    version_id: input.versionId,
    version_number: input.versionNumber,
    to: text(input.to, SHARED_LIMITS.to),
    on: text(input.on, 10),
    ...(text(input.how, SHARED_LIMITS.how) ? { how: text(input.how, SHARED_LIMITS.how) } : {}),
    ...(text(input.note, SHARED_LIMITS.note) ? { note: text(input.note, SHARED_LIMITS.note) } : {}),
    ...(input.notSending ? { not_sending: true } : {}),
  };
}

/** Taking a record back: it names the record, and keeps the version id the database asks for. */
export function undoPayload(record: Pick<SharedRecord, 'recordId' | 'versionId'>): Record<string, unknown> {
  return { undoes: record.recordId, version_id: record.versionId };
}

/** A record's own id. */
export function newRecordId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
