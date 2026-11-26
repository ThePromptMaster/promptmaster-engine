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
 *
 * 26 Nov (L-284, L-285): one paste is one batch, whatever number of calls it
 * takes, and what is left carries that number on. A stop keeps what was saved.
 * A reply that came back cut off or unreadable keeps the rest of the paste to
 * assess rather than taking its silence for "nothing left": a name already
 * judged is skipped when it is sent again.
 */

import { ASSESS_MAX_CALLS, appendBatch, batchChunk, nextBatch, restAfter, type AssessPending, type AssessedRow } from './assess';
import type { StageItem } from './stage-artifact';

export interface BatchReply {
  items: AssessedRow[];
  ungraded: number;
  not_assessed: number;
  next_from?: string;
  already_in_table?: number;
  web_query?: string | null;
  /** 'stop' when the model answered in full; 'length' cut off, 'error' unreadable. */
  finish_reason?: string;
}

export interface AssessRunResult {
  items: StageItem[];
  added: number;
  ungraded: number;
  alreadyIn: number;
  pending: AssessPending | null;
  webQueries: string[];
  calls: number;
  /** The run was stopped part-way; what was saved stays. */
  stopped: boolean;
  /** A reply came back cut off or unreadable, so the rest was kept to assess. */
  cut: boolean;
  /** The batch this paste was given. */
  batch: string;
}

function aborted(signal: AbortSignal | undefined, e?: unknown): boolean {
  return Boolean(signal?.aborted) || (e instanceof Error && e.name === 'AbortError');
}

export async function assessPaste(args: {
  text: string;
  existing: StageItem[];
  call: (chunk: string, already: string[]) => Promise<BatchReply>;
  /** Saves the table after each call. */
  save: (items: StageItem[], pending: AssessPending | null, added: number) => Promise<void>;
  /** After each save: rows added so far, and how many the last call said were left. */
  onProgress?: (assessed: number, left: number | null) => void;
  now?: () => string;
  maxCalls?: number;
  /** The batch to add to: a paste's leftovers carry theirs. A new paste takes the next number. */
  batch?: string;
  /** Stops between calls, or the call in flight; what was saved stays. */
  signal?: AbortSignal;
}): Promise<AssessRunResult> {
  const now = args.now ?? (() => new Date().toISOString());
  const batch = args.batch || String(nextBatch(args.existing));
  let rest = args.text.trim();
  let items = args.existing;
  let added = 0;
  let ungraded = 0;
  let alreadyIn = 0;
  let pending: AssessPending | null = null;
  const webQueries: string[] = [];
  let calls = 0;
  let stopped = false;
  let cut = false;
  while (rest && calls < (args.maxCalls ?? ASSESS_MAX_CALLS)) {
    if (aborted(args.signal)) {
      stopped = true;
      break;
    }
    const chunk = batchChunk(rest);
    let reply: BatchReply;
    try {
      reply = await args.call(chunk, items.map((i) => i.subject ?? '').filter(Boolean));
    } catch (e) {
      if (!aborted(args.signal, e)) throw e;
      stopped = true;
      break;
    }
    calls += 1;
    if (reply.web_query) webQueries.push(reply.web_query);
    const before = items.length;
    // Each row keeps its own part of what was pasted, for the shortlist to quote (18 Nov).
    items = appendBatch(items, reply.items, now(), chunk, batch);
    const fresh = items.length - before;
    added += fresh;
    ungraded += reply.ungraded ?? 0;
    alreadyIn += reply.already_in_table ?? 0;
    const incomplete = Boolean(reply.finish_reason) && reply.finish_reason !== 'stop';
    const next = incomplete ? null : restAfter(rest, chunk, reply);
    if (incomplete) cut = true;
    // Left over and not findable, a reply cut off or unreadable, or a call that
    // judged nothing and left items: the rest is kept, not looped on.
    if (next === null || (next && !fresh && !reply.items.length && next === rest)) {
      pending = { text: rest, count: incomplete ? 0 : reply.not_assessed ?? 0, batch };
      rest = '';
    } else {
      rest = next;
      pending = rest ? { text: rest, count: reply.not_assessed ?? 0, batch } : null;
    }
    await args.save(items, pending, fresh);
    args.onProgress?.(added, pending ? pending.count || null : 0);
  }
  return { items, added, ungraded, alreadyIn, pending, webQueries, calls, stopped, cut, batch };
}
