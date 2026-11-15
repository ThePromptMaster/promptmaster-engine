/**
 * A whole paste judged, a batch at a time (15 Nov, Sean: 25 profiles pasted,
 * "12 assessed and added to the table. 13 more were in the paste; assess them in
 * another batch" — and the 13 were gone; "it will only do like 12 people at a
 * time … can we make it a big amount?").
 *
 * One call judges at most twelve items and says where the first one it did not
 * judge begins; the next call starts there. Each call's rows are saved as they
 * come, so a stop part-way keeps what was judged, and what is left is kept with
 * the table as `pending`, for "Assess the remaining N". Names already in the
 * table are not judged or added again. The page and Go both use this.
 */

import { ASSESS_MAX_CALLS, appendBatch, batchChunk, restAfter, type AssessPending, type AssessedRow } from './assess';
import type { StageItem } from './stage-artifact';

export interface BatchReply {
  items: AssessedRow[];
  ungraded: number;
  not_assessed: number;
  next_from?: string;
  already_in_table?: number;
  web_query?: string | null;
}

export interface AssessRunResult {
  items: StageItem[];
  added: number;
  ungraded: number;
  alreadyIn: number;
  pending: AssessPending | null;
  webQueries: string[];
  calls: number;
}

export async function assessPaste(args: {
  text: string;
  existing: StageItem[];
  call: (chunk: string, already: string[]) => Promise<BatchReply>;
  /** Saves the table after each call. */
  save: (items: StageItem[], pending: AssessPending | null, added: number) => Promise<void>;
  onProgress?: (assessed: number) => void;
  now?: () => string;
  maxCalls?: number;
}): Promise<AssessRunResult> {
  const now = args.now ?? (() => new Date().toISOString());
  let rest = args.text.trim();
  let items = args.existing;
  let added = 0;
  let ungraded = 0;
  let alreadyIn = 0;
  let pending: AssessPending | null = null;
  const webQueries: string[] = [];
  let calls = 0;
  while (rest && calls < (args.maxCalls ?? ASSESS_MAX_CALLS)) {
    const chunk = batchChunk(rest);
    const reply = await args.call(chunk, items.map((i) => i.subject ?? '').filter(Boolean));
    calls += 1;
    if (reply.web_query) webQueries.push(reply.web_query);
    const before = items.length;
    items = appendBatch(items, reply.items, now());
    const fresh = items.length - before;
    added += fresh;
    ungraded += reply.ungraded ?? 0;
    alreadyIn += reply.already_in_table ?? 0;
    const next = restAfter(rest, chunk, reply);
    // Left over and not findable, or a call that judged nothing and left items: kept, not looped on.
    if (next === null || (next && !fresh && !reply.items.length && next === rest)) {
      pending = { text: rest, count: reply.not_assessed ?? 0 };
      rest = '';
    } else {
      rest = next;
      pending = rest ? { text: rest, count: reply.not_assessed ?? 0 } : null;
    }
    await args.save(items, pending, fresh);
    args.onProgress?.(added);
  }
  return { items, added, ungraded, alreadyIn, pending, webQueries, calls };
}
