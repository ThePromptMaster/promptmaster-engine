/**
 * The passage behind a quote (Sean, 23 Nov: "jump to the transcript passage
 * behind a finding"). Pure; no model is asked.
 *
 * A version's quotes are the spans it puts in quotation marks, the lines it
 * quotes with ">", and in a table the fields named quote or evidence. Each is
 * looked for, word for word up to case, quote marks, dashes and spacing, in the
 * documents the project and its folders hold. A quote with "…" in it is matched
 * by its longest part. Only quotes long enough to mean something are looked
 * for, so "yes" never lands on the first "yes" of a transcript.
 */

export interface SourceDoc {
  name: string;
  text: string;
  /** Where it is kept: a folder's name and kind, or null for the project itself. */
  level: { name: string; kind: string | null } | null;
}

export interface QuoteLink {
  quote: string;
  doc: SourceDoc;
  /** Raw offsets in `doc.text`. */
  start: number;
  end: number;
  /** How many places in the documents it matches. */
  matches: number;
}

const MIN_CHARS = 24;
const MIN_WORDS = 5;

function longEnough(q: string): boolean {
  return q.length >= MIN_CHARS || q.split(/\s+/).filter(Boolean).length >= MIN_WORDS;
}

/** The quotes a version's text makes, in order, without repeats. */
export function quotesIn(content: string): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const q = raw.replace(/\s+/g, ' ').trim().replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '').trim();
    if (q && longEnough(q) && !out.includes(q)) out.push(q);
  };
  const trimmed = content.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const walk = (v: unknown, key = ''): void => {
        if (Array.isArray(v)) v.forEach((x) => walk(x, key));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
        else if (typeof v === 'string') {
          if (/quote|evidence|verbatim/i.test(key)) add(v);
          else spans(v).forEach(add);
        }
      };
      walk(JSON.parse(trimmed));
      return out;
    } catch {
      // Not JSON after all: read it as text.
    }
  }
  spans(content).forEach(add);
  return out;
}

/** Quoted spans and ">" lines in a text. */
function spans(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/“([^”\n]{8,800})”|"([^"\n]{8,800})"|«([^»\n]{8,800})»/g)) found.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of text.matchAll(/^\s*>\s?(.+)$/gm)) found.push(m[1].replace(/^\*+|\*+$/g, ''));
  return found;
}

/** A text made comparable, with a map from each kept character back to its raw offset. */
export function normalised(text: string): { norm: string; at: number[] } {
  const chars: string[] = [];
  const at: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i += 1) {
    let c = text[i];
    if (/[“”«»„"]/.test(c)) c = '"';
    else if (/[‘’`´]/.test(c)) c = "'";
    else if (/[–—−]/.test(c)) c = '-';
    else if (/[*_#]/.test(c)) continue;
    if (/\s/.test(c)) {
      if (space) continue;
      chars.push(' ');
      at.push(i);
      space = true;
      continue;
    }
    chars.push(c.toLowerCase());
    at.push(i);
    space = false;
  }
  return { norm: chars.join(''), at };
}

function needle(quote: string): string {
  // "… in the board pack … we cut 40 roles": the longest part stands for it.
  const parts = quote.split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.trim()).filter(Boolean);
  const best = parts.sort((a, b) => b.length - a.length)[0] ?? quote;
  return normalised(best).norm.replace(/^["'\s]+|["'\s.,;:]+$/g, '');
}

/** Where each quote is found in the documents; a quote found nowhere is left out. */
export function linkQuotes(quotes: readonly string[], docs: readonly SourceDoc[]): QuoteLink[] {
  const prepared = docs.map((doc) => ({ doc, ...normalised(doc.text) }));
  const out: QuoteLink[] = [];
  for (const quote of quotes) {
    const n = needle(quote);
    if (!longEnough(n)) continue;
    let first: QuoteLink | null = null;
    let matches = 0;
    for (const p of prepared) {
      let from = 0;
      for (;;) {
        const i = p.norm.indexOf(n, from);
        if (i < 0) break;
        matches += 1;
        if (!first) first = { quote, doc: p.doc, start: p.at[i], end: p.at[i + n.length - 1] + 1, matches: 0 };
        from = i + n.length;
      }
    }
    if (first) out.push({ ...first, matches });
  }
  return out;
}

/** The documents a project's material holds: its own ("### From" sections) and its folders'. */
export function sourceDocs(
  context: string | undefined,
  folderDocs: readonly { doc: { name: string; text: string }; level: { name: string; kind: string | null } }[] = []
): SourceDoc[] {
  const own: SourceDoc[] = [];
  const parts = (context ?? '').split(/^### From (.+)$/m);
  if (parts[0]?.trim()) own.push({ name: '', text: parts[0], level: null });
  for (let i = 1; i < parts.length; i += 2) {
    if ((parts[i + 1] ?? '').trim()) own.push({ name: parts[i].trim(), text: parts[i + 1], level: null });
  }
  return [...own, ...folderDocs.filter((d) => d.doc.text.trim()).map((d) => ({ name: d.doc.name, text: d.doc.text, level: d.level }))];
}
