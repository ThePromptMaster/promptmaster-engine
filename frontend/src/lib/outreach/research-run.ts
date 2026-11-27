/**
 * Filling in the blanks, five contacts a call, saved after each (Sean, 26 Nov). The page's
 * "Fill in the blanks" and Go's `research_contacts` both run this, under one lock per stage
 * (`lib/workflow/assess-lock.ts`, keyed by the Contacts stage), so the two never search the same
 * list at once. A stop keeps every batch already saved.
 */
import { parseContacts, serializeContacts, type ContactsDocument } from './contacts';
import { mergeResearch, needsResearch, researchRow, RESEARCH_BATCH, type ResearchedRow, type ResearchRow } from './research';

export interface ResearchResponse {
  rows: ResearchedRow[];
  web_query?: string;
  web_sources?: { url: string; title: string; excerpt: string }[];
  web_note?: string;
  model_used?: string;
}

export interface ResearchRunInput {
  /** The Contacts stage's current content. */
  content: string | null | undefined;
  /** One backend call for up to five rows. */
  call: (rows: ResearchRow[]) => Promise<ResearchResponse>;
  /** Save the call's sources to the project (`keepFound`), renumbering the response's citations in place. */
  keep: (res: ResearchResponse) => Promise<unknown>;
  /** Save the Contacts stage's next version. */
  save: (content: string, summary: string) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  now?: () => string;
}

export interface ResearchRunResult {
  /** Rows searched. */
  researched: number;
  /** Rows that gained at least one value. */
  filled: number;
  /** Rows still waiting for a search. */
  left: number;
  stopped: boolean;
  error?: string;
}

/** How many rows a run would search. */
export function researchLeft(content: string | null | undefined): number {
  return parseContacts(content).items.filter(needsResearch).length;
}

export async function runResearch(input: ResearchRunInput): Promise<ResearchRunResult> {
  let doc: ContactsDocument = parseContacts(input.content);
  const queue = doc.items.filter(needsResearch).map((r) => r.id);
  const total = queue.length;
  let researched = 0;
  let filled = 0;
  input.onProgress?.(0, total);
  while (queue.length) {
    if (input.signal?.aborted) return { researched, filled, left: queue.length, stopped: true };
    const ids = queue.splice(0, RESEARCH_BATCH);
    const rows = doc.items.filter((r) => ids.includes(r.id));
    let res: ResearchResponse;
    try {
      res = await input.call(rows.map(researchRow));
      await input.keep(res);
    } catch (e) {
      // Stop pressed while a call was out: that call is dropped, and the run says it stopped (27 Nov pass).
      if (input.signal?.aborted) return { researched, filled, left: queue.length + ids.length, stopped: true };
      return { researched, filled, left: queue.length + ids.length, stopped: false, error: e instanceof Error ? e.message : String(e) };
    }
    const at = input.now?.() ?? new Date().toISOString();
    const byId = new Map(res.rows.map((r) => [r.id, r]));
    let gained = 0;
    doc = {
      ...doc,
      items: doc.items.map((row) => {
        if (!ids.includes(row.id)) return row;
        const next = mergeResearch(row, byId.get(row.id), at);
        if (next.added !== row.added) gained += 1;
        return next;
      }),
    };
    researched += ids.length;
    filled += gained;
    await input.save(serializeContacts(doc), `Searched the web for ${ids.length} contact${ids.length === 1 ? '' : 's'}; filled in ${gained}.`);
    input.onProgress?.(researched, total);
  }
  return { researched, filled, left: 0, stopped: false };
}
