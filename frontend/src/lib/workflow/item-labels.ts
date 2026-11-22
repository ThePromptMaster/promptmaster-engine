/**
 * The labelled items a text names: "Option B", "Site 3", "Phase II" (L-270).
 *
 * 21 Nov, Sean, scanner replacement: "The Option B vendor has corrected the
 * training charge from $6,000 to $7,500" was offered as a change to the
 * Option A and Option C facts as well, because they share "option",
 * "vendor" and "training". A sentence about one item is not about its
 * siblings. Read in code, never by a model. Pure.
 *
 * The same pattern is in `backend/promptmaster/reply_actions.py`
 * (`item_labels`): keep the two in step.
 */

/** Words that read as a head but never name a kind of item: "December 18", "The B…". */
const NOT_HEADS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'the', 'and', 'but', 'for', 'with', 'from', 'under', 'over', 'each', 'every', 'all', 'both', 'only', 'not', 'than', 'this', 'that',
  'about', 'after', 'before', 'until', 'since', 'by', 'at', 'on', 'in', 'to', 'of', 'per', 'via', 'and/or',
]);

const ID = String.raw`(?:[A-Z]|\d{1,3}|[IVX]{2,4})`;
/** "Option B", "Options A and C", "Sites 1, 2 and 3". The id is not followed by a letter or digit ("Option Board" is not an item). */
const LABEL = new RegExp(String.raw`\b([A-Z][a-z]{2,})\s+(${ID}(?:\s*(?:,|and|&|or)\s*${ID})*)(?![A-Za-z0-9])`, 'g');

/** "Options" and "option" are one kind. */
function headOf(word: string): string {
  const w = word.toLowerCase();
  return w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/** Each kind of item the text names, with the ids it names: "Option B" gives option → {B}. */
export function itemLabels(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of text.matchAll(LABEL)) {
    const head = headOf(m[1]);
    if (NOT_HEADS.has(head)) continue;
    const ids = m[2].split(/\s*(?:,|and|&|or)\s*/).map((s) => s.trim()).filter(Boolean);
    if (!out.has(head)) out.set(head, new Set());
    for (const id of ids) out.get(head)!.add(id.toUpperCase());
  }
  return out;
}

/** "all options", "each option's", "every site", "both options": the text speaks of every item of the kind. */
function speaksOfEvery(text: string, head: string): boolean {
  return new RegExp(String.raw`\b(?:all|each|every|both)\b(?:\s+(?:of\s+)?(?:the\s+)?(?:\w+\s+)?)?${head}s?\b`, 'i').test(text);
}

/** A kind of item written in the plural with no id: "the options' training", "for all sites". */
function speaksOfKind(text: string, head: string): boolean {
  return speaksOfEvery(text, head) || new RegExp(String.raw`\b${head}s\b(?!\s+${ID}(?![A-Za-z0-9]))`, 'i').test(text);
}

/**
 * The sentence names an item of a kind the fact is about, and not the fact's
 * own: "Option B's training …" is not about "Option A: … $6,000 training". A
 * fact about every item of the kind ("Each option includes $6,000 training")
 * is not one item's either. A sentence that speaks of every item of the kind
 * ("every option's training is now $7,500") is about them all.
 */
export function aboutAnotherItem(sentence: string, fact: string): boolean {
  const said = itemLabels(sentence);
  if (!said.size) return false;
  const factItems = itemLabels(fact);
  for (const [head, ids] of said) {
    if (speaksOfEvery(sentence, head)) continue;
    const own = factItems.get(head);
    if (own) {
      if (![...ids].some((id) => own.has(id))) return true;
      continue;
    }
    // A fact about the kind as a whole: one item's change is not its value.
    if (speaksOfKind(fact, head)) return true;
  }
  return false;
}
