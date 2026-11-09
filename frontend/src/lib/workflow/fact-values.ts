/**
 * The particular values a fact states — dates, amounts of money, other
 * numbers — in a form that matches however a later text writes them (8 Oct).
 *
 * Sean changed TeamNotes' launch from November 12 to November 19 and its price
 * from $12 to $15; the stages that said "Nov 12" or "12 November" were not
 * found by matching the fact's sentence, and a repair that kept "November 12"
 * was saved as done. Pure; no model call.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+${DAY}\\b`, 'gi');
const DAY_MONTH = new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, 'gi');
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const MONEY = /(?:[$€£]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:usd|dollars?|eur|euros?|gbp|pounds?)\b)/gi;
const NUMBER = /(?<![\d.])\d[\d,]*(?:\.\d+)?(?![\d])/g;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// Full names and the unambiguous short forms; "Wed", "Sat" and "Sun" alone are left out.
const WEEKDAY = /\b(monday|tuesday|tues|wednesday|weds|thursday|thurs|friday|saturday|sunday)s?\b/gi;
// "12:30", "1:00 p.m.", "1 pm", "noon": a time of day (10 Oct, Sean: Thursday at 12:30 → Wednesday at 1:00 p.m.).
const TIME = /\b(?:(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\b\.?)?|(\d{1,2})\s*([ap])\.?\s?m\b\.?|(noon|midday))/gi;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const UNIT = '(words?|pages?|characters?|sentences?|paragraphs?|slides?|minutes?)';
const COUNT = '(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)';
// A length the text is held to: "under 120 words", "no more than 2 pages", "70 words or fewer", "a one-page plan".
const LIMIT_BEFORE = new RegExp(`\\b(?:under|fewer than|less than|no more than|not more than|at most|maximum(?: of)?|max\\.?|up to|within|below)\\s+${COUNT}[\\s-]+${UNIT}\\b`, 'gi');
const LIMIT_AFTER = new RegExp(`\\b${COUNT}[\\s-]+${UNIT}\\s+(?:or (?:fewer|less)|max(?:imum)?|at most|or under)\\b`, 'gi');
const SINGLE = /\b(one|single)[\s-](page|slide|paragraph)\b/gi;

export interface FactValues {
  /** "11-12" for November 12, however it is written; the year is not part of it. */
  dates: string[];
  /** "12" for $12, $12.00, 12 USD. */
  money: string[];
  /** "thursday" for Thursday, Thurs. */
  weekdays: string[];
  /** "12:30" for 12:30 or 12:30 p.m.; "13:00" for 1:00 p.m. or 1 pm. */
  times: string[];
  /** "words:120" for "under 120 words": a length the text is held to. */
  limits: string[];
  /** Other numbers, commas removed; years and the parts of dates, amounts, times and limits excluded. */
  numbers: string[];
}

/** One value as a text writes it: what it is, and the words that said it. */
export interface ValueMention {
  kind: keyof FactValues;
  value: string;
  raw: string;
}

const KINDS = ['dates', 'money', 'weekdays', 'times', 'limits', 'numbers'] as const;

const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const amount = (raw: string) => {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : raw.replace(/,/g, '');
};
const weekday = (raw: string) => WEEKDAYS.find((d) => d.startsWith(raw.toLowerCase().slice(0, 3))) ?? raw.toLowerCase();
const count = (raw: string) => NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw.replace(/,/g, ''));
const unit = (raw: string) => raw.toLowerCase().replace(/s$/, '');
function clock(h: number, m: number, half?: string): string {
  let hour = h;
  if (half?.toLowerCase() === 'p' && hour < 12) hour += 12;
  if (half?.toLowerCase() === 'a' && hour === 12) hour = 0;
  return `${hour}:${String(m).padStart(2, '0')}`;
}

/** Every value `text` states, in the order each kind is read; a span read as one kind is not read again. */
export function valueMentions(text: string): ValueMention[] {
  const out: ValueMention[] = [];
  let rest = text;
  const take = (re: RegExp, add: (m: RegExpExecArray) => Omit<ValueMention, 'raw'> | null) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const v = add(m);
      if (!v) return m[0];
      out.push({ ...v, raw: m[0].trim() });
      return ' ';
    });
  };
  take(MONTH_DAY, (m) => ({ kind: 'dates', value: `${month(m[1])}-${Number(m[2])}` }));
  take(DAY_MONTH, (m) => ({ kind: 'dates', value: `${month(m[2])}-${Number(m[1])}` }));
  take(NUMERIC_DATE, (m) => (Number(m[1]) <= 12 && Number(m[2]) <= 31 ? { kind: 'dates', value: `${Number(m[1])}-${Number(m[2])}` } : null));
  take(MONEY, (m) => ({ kind: 'money', value: amount(m[1] ?? m[2]) }));
  take(LIMIT_BEFORE, (m) => ({ kind: 'limits', value: `${unit(m[2])}:${count(m[1])}` }));
  take(LIMIT_AFTER, (m) => ({ kind: 'limits', value: `${unit(m[2])}:${count(m[1])}` }));
  take(SINGLE, (m) => ({ kind: 'limits', value: `${unit(m[2])}:1` }));
  take(WEEKDAY, (m) => ({ kind: 'weekdays', value: weekday(m[1]) }));
  take(TIME, (m) => {
    if (m[6]) return { kind: 'times', value: '12:00' };
    const h = Number(m[1] ?? m[4]);
    const min = m[2] !== undefined ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    return { kind: 'times', value: clock(h, min, m[3] ?? m[5]) };
  });
  for (const n of rest.match(NUMBER) ?? []) {
    const value = n.replace(/,/g, '');
    if (!/^(19|20)\d\d$/.test(value)) out.push({ kind: 'numbers', value, raw: n });
  }
  return out;
}

export function factValues(text: string): FactValues {
  const sets = Object.fromEntries(KINDS.map((k) => [k, new Set<string>()])) as Record<keyof FactValues, Set<string>>;
  for (const v of valueMentions(text)) sets[v.kind].add(v.value);
  return Object.fromEntries(KINDS.map((k) => [k, [...sets[k]]])) as unknown as FactValues;
}

/** Whether `text` states this date / amount / number, in any of the forms above. */
export function statesValue(text: string, kind: keyof FactValues, value: string): boolean {
  return factValues(text)[kind].includes(value);
}

export interface SupersededValue {
  kind: keyof FactValues;
  /** As the old fact wrote it, for the message. */
  was: string;
  /** The new fact's statement. */
  now: string;
  value: string;
}

/**
 * The values an old fact stated that its replacement no longer does: what a
 * repaired stage must not still say. A value the new fact keeps (the year, a
 * date that did not move) is not superseded.
 */
export function supersededValues(oldStatement: string, newStatement: string): SupersededValue[] {
  // A recorded answer carries the question it answered ("December 3 or
  // December 10?"): only what was answered is the user's value (8 Oct,
  // production: December 3 and $24 were treated as values to remove).
  const was = factValues(answered(oldStatement));
  const now = factValues(answered(newStatement));
  const out: SupersededValue[] = [];
  for (const kind of KINDS) {
    for (const value of was[kind]) {
      if (!now[kind].includes(value)) out.push({ kind, was: oldStatement, now: newStatement, value });
    }
  }
  return out;
}

/** The part of a recorded answer that is the answer. */
export function answered(statement: string): string {
  const at = statement.lastIndexOf('answered:');
  return at >= 0 ? statement.slice(at + 'answered:'.length) : statement;
}

/**
 * Words that attribute a value to a source or set it aside: "Source A says
 * $18", "do not use $24", "previously November 12". Such a sentence reports
 * the value; it does not state it as current (8 Oct, production: a reviewed
 * prompt restating the two sources could never pass the leftover check).
 * "Not adopted" reports a proposal the record replaced (19 Oct, Ridgeway copy:
 * "tied to the 100 hours, which were not adopted" failed two repairs).
 */
const ATTRIBUTED = /\b(sources?|exclud\w*|conflict\w*|supersed\w*|instead of|replac\w*|previous\w*|earlier|formerly|alternative\w*|no longer|rather than|do not use|don't use|not use|was (?:originally|initially)|histor(?:y|ical)|changed from|originally|request(?:s|ed)?|asks?|asked|declined|rejected|not (?:adopted|approved|authori[sz]ed|taken up)|propos(?:al|als|ed|es)|v\d+)\b/i;

/**
 * A section that records history: a change log, a decision log, superseded
 * values. Its lines report earlier values by design (Sean, 14 Oct, SUMMIT:
 * "some earlier revisions also dropped prior values from the visible change
 * log" — the repair's retry was told to replace them).
 */
const HISTORY_HEADING = /\b(change ?log|changes|decision (?:and change )?log|decisions? log|history|superseded|revision log|audit trail|what changed)\b/i;

/**
 * Text in quotation marks reports what a document said ("the memo says \"the
 * approved November 20 launch date is achievable\""); it does not state it
 * (14 Oct, JUNIPER: a review quoting version 1 failed the repair). In JSON
 * only escaped or curly quotes are quotations.
 */
function withoutQuotations(text: string): string {
  const json = /^\s*[[{]/.test(text);
  let out = text.replace(/\\"(?:[^"\\]|\\(?!"))*\\"/g, ' ').replace(/[“][^”]*[”]/g, ' ');
  if (!json) out = out.replace(/"[^"\n]{1,400}"/g, ' ');
  return out;
}

/**
 * "Testing — November 16 to November 20": a span of days for a task, not the
 * single date a fact gave (14 Oct, JUNIPER: a testing window ending on the old
 * launch date read as the launch date left behind). Removed only when the old
 * fact itself gave no span.
 */
const RANGE = new RegExp(
  `(?:\\b${MONTH}\\s+)?\\b\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\s*(?:to|through|until|thru|–|—|-)\\s*(?:${MONTH}\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\b`,
  'gi'
);

/** The pieces a check reads a text in: its sentences, lines and JSON strings. */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\\n/g, '\n')
    .split(/(?<=[.!?;])\s+|\s*\n\s*|",\s*"/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** What works one figure out from others: a sign, or the word for one. */
const OPERATOR = /[−–\-+×*÷/]|\b(?:x|less|minus|plus|times|divided)\b/i;
/** Before a result: "= $400", "≈ 20", "≥ 12", "equals $400", "leaves $400". */
const RESULT = /(?:[=≈≤≥<>]|\bequals?\b|\bleav(?:es|ing)\b|\bcomes? to\b)\s*/gi;
/** A one-letter variable bounded by a value: "c ≤ $40", "x < 12". */
const BOUND = /(?<![\p{L}\p{N}])\p{L}\s*(?:≤|≥|<=|>=|<|>)\s*/gu;
const FIGURE = /^\(?\s*((?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:usd|dollars?|eur|euros?|gbp|pounds?)\b)?)/i;

/**
 * Paired emphasis taken off, so "= **$8,000**" reads as a figure (7 Nov,
 * production, a rollout plan: "8 × $1,000 = **$8,000**" for training was read
 * as the old $8,000 migration price, and three repairs failed on it). A lone
 * "*" is a multiplication sign and stays.
 */
function withoutEmphasis(text: string): string {
  return text.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2');
}

/**
 * The amounts and plain numbers a text works out as results — "$1,200 − $800
 * = $400", "c ≤ $40" — keyed by value alone, since a derived "40" and "$40"
 * are the same figure (2 Nov, Sean, photography workshop: the spendable $400
 * left after the new $800 reserve was read as the old $400 reserve, and the
 * $40 ceiling on Option C's cost as the old $40 ticket; every repair failed).
 * "Price = $40" works nothing out: the left side must hold another figure and
 * an operator.
 */
export function derivedValues(text: string): Set<string> {
  const out = new Set<string>();
  const add = (right: string) => {
    const m = FIGURE.exec(right);
    if (!m) return;
    const v = valueMentions(m[1]).find((x) => x.kind === 'money' || x.kind === 'numbers');
    if (v) out.add(v.value);
  };
  for (const raw of sentencesOf(text)) {
    const piece = withoutEmphasis(raw);
    for (const m of piece.matchAll(RESULT)) {
      const left = piece.slice(0, m.index);
      if (/\d/.test(left) && OPERATOR.test(left)) add(piece.slice(m.index! + m[0].length));
    }
    for (const m of piece.matchAll(BOUND)) add(piece.slice(m.index! + m[0].length));
    for (const result of computedResults(piece)) add(`$${Number.isInteger(result) ? result : result.toFixed(2)}`);
  }
  return out;
}

const SUM_NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const SUM_TOKENS = /(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?|[×*÷+−]|\s[-–/]\s|\p{L}+/gu;

function operatorOf(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (t === '×' || t === '*' || t === 'x' || t === 'at') return '*';
  if (t === '÷' || t === '/') return '/';
  if (t === '+' || t === 'plus') return '+';
  if (t === '−' || t === '-' || t === '–' || t === 'minus' || t === 'less') return '-';
  return null;
}

/** One side of a sum as a number, or null. A number word counts only at the start of a sum. */
function termOf(token: string, atStart: boolean): number | null {
  if (/\d/.test(token)) return Number(token.replace(/[^\d.]/g, ''));
  return atStart ? (SUM_NUMBER_WORDS[token.toLowerCase()] ?? null) : null;
}

/** Multiplication first, then addition, left to right. */
function evaluated(chain: readonly (number | string)[]): number {
  const sums: (number | string)[] = [chain[0]];
  for (let i = 1; i < chain.length; i += 2) {
    const op = chain[i] as string;
    const n = chain[i + 1] as number;
    if (op === '*' || op === '/') {
      const left = sums.pop() as number;
      sums.push(op === '*' ? left * n : left / n);
    } else sums.push(op, n);
  }
  let total = sums[0] as number;
  for (let i = 1; i < sums.length; i += 2) total += sums[i] === '+' ? (sums[i + 1] as number) : -(sums[i + 1] as number);
  return total;
}

/**
 * What the sums written in a piece come to, wherever the result is put: "8 ×
 * $1,000" in one table cell beside $8,000 in the next, or "Eight sessions at
 * $1,000" (9 Nov, production: "| Training | $8,000 | 8 × $1,000 |" put the
 * result before the sum, nothing said it was worked out, and two repairs failed
 * on the old $8,000 migration price). Up to two words may sit between a figure
 * and its sign ("8 sessions × $1,000"); none between a sign and its figure, so
 * "$58,000, with at least $7,000" is no sum.
 */
function computedResults(piece: string): number[] {
  const results: number[] = [];
  let chain: (number | string)[] = [];
  let words = 0;
  const flush = () => {
    if (chain.length >= 3 && chain.length % 2 === 1) {
      const r = evaluated(chain);
      if (Number.isFinite(r) && r > 0) results.push(r);
    }
    chain = [];
    words = 0;
  };
  for (const token of piece.match(SUM_TOKENS) ?? []) {
    const afterFigure = chain.length % 2 === 1;
    const operator = operatorOf(token);
    if (afterFigure && operator) {
      chain.push(operator);
      words = 0;
      continue;
    }
    const term = termOf(token, chain.length === 0);
    if (term !== null) {
      if (afterFigure) flush();
      chain.push(term);
      words = 0;
      continue;
    }
    if (afterFigure && /\p{L}/u.test(token) && ++words <= 2) continue;
    flush();
  }
  flush();
  return results;
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'will', 'must', 'only', 'also', 'each', 'more', 'than', 'into', 'which',
  'their', 'there', 'these', 'those', 'about', 'after', 'before', 'still', 'remain', 'remains', 'keep', 'kept', 'stays',
  'should', 'shall', 'would', 'could', 'when', 'where', 'what', 'while', 'every', 'other', 'same', 'such', 'over', 'under',
  'least', 'most', 'none', 'instead', 'replacing', 'replaces', 'replaced', 'superseding', 'supersedes', 'previously', 'earlier',
]);
const stem = (w: string) => w.toLowerCase().replace(/(?<!s)s$/, '');
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** The words a fact names its subject with: "minimum", "unspent", "reserve" for "The minimum unspent reserve is $800". */
function subjectWords(statement: string): string[] {
  const words = statement.replace(/[$€£]?\d[\d,.]*/g, ' ').match(/\p{L}{4,}/gu) ?? [];
  return [...new Set(words.map(stem).filter((w) => !STOPWORDS.has(w) && !ATTRIBUTED.test(w)))];
}

const SIGN = /[−–\-+×*÷/=≈≤≥<>]/;

/**
 * Whether a mention of `s` in `piece` sits within four words of what the fact
 * is about. In a calculation the words before it label the result, so only
 * the words straight after it name what it is: "the reserve preserved: ($400
 * − $300) ÷ $5 = 20" is not a $400 reserve; "$1,200 − $400 reserve" is.
 */
function boundToSubject(piece: string, s: SupersededValue, subject: readonly string[]): boolean {
  const raws = valueMentions(piece).filter((m) => m.kind === s.kind && m.value === s.value).map((m) => m.raw);
  for (const raw of new Set(raws)) {
    for (let at = piece.indexOf(raw); at >= 0; at = piece.indexOf(raw, at + raw.length)) {
      const left = piece.slice(0, at).replace(/[\s(]+$/, '');
      const right = piece.slice(at + raw.length);
      const operand = SIGN.test(left.slice(-1)) || SIGN.test(right.replace(/^[\s)]+/, '').charAt(0));
      const before = operand ? [] : (left.match(/\p{L}+/gu) ?? []).slice(-4);
      const after = ((operand ? right.split(/[\d−–\-+×*÷/=≈≤≥<>]/)[0] : right).match(/\p{L}+/gu) ?? []).slice(0, 4);
      if ([...before, ...after].some((w) => subject.some((x) => sameWord(stem(w), x)))) return true;
    }
  }
  return false;
}

/** "Data migration" in "Data migration: $8,000 fixed.", as words; empty when the old figure had no label of its own. */
function labelOfOldFigure(s: SupersededValue): string[] {
  const said = answered(s.was);
  const raw = valueMentions(said).find((m) => m.kind === 'money' && m.value === s.value)?.raw;
  if (!raw) return [];
  const at = said.indexOf(raw);
  // "Data migration: $8,000", or one of a list: "Fixed prices: mapping $6,000; migration $8,000".
  const clause = said.slice(0, at).split(/[.;,\n]|\band\b/).at(-1) ?? '';
  const before = labelWords(clause.replace(/\s*[:—–=]\s*$/u, '').split(':').at(-1) ?? '');
  if (before.length) return before;
  // "$8,000 for data migration".
  return labelWords((said.slice(at + raw.length).split(/[.;,\n]/)[0] ?? '').replace(/^\s*(?:for|per|on|in|to)\b/i, ''));
}

function labelWords(label: string): string[] {
  return [...new Set((label.match(/\p{L}{4,}/gu) ?? []).map(stem).filter((w) => !STOPWORDS.has(w)))];
}

/** What a table row, a "Label: value" line or "Training costs $8,000" says it is about. */
function pieceLabel(piece: string): string {
  const cell = /^\s*\|\s*([^|]+?)\s*\|/.exec(piece)?.[1];
  if (cell !== undefined) return cell;
  const named = /^\s*(?:[-*+]\s+)?(\p{L}[^:|]{1,48}?):\s/u.exec(piece)?.[1];
  if (named !== undefined) return named;
  return /^\s*(\p{L}[\p{L}\s,-]{1,48}?)\s+(?:costs?|totals?|is|are|comes? to|runs? at)\s+[$€£]?\d/u.exec(piece)?.[1] ?? '';
}

/** Words any line about money may use: they say nothing about which money it is. */
const MONEY_WORDS = new Set(['cost', 'price', 'amount', 'fixed', 'total', 'charge', 'spend', 'spending', 'line', 'item', 'figure', 'planned', 'payment']);

/**
 * A line that labels itself as being about something else than the figure the
 * fact replaced: "| Training | $8,000 |" is not the old "Data migration:
 * $8,000", and neither is "Training costs $8,000." The figure's own words are
 * looked for anywhere in the line, and a label that names nothing ("Amount",
 * "The fee") is read strictly. Money only, only when the old figure carried a
 * label of its own, and never where the figure is an operand: "Revenue at 8
 * paid: 8 × $40 = $320" uses the old $40, whatever the line calls itself.
 */
function aboutSomethingElse(piece: string, s: SupersededValue): boolean {
  if (s.kind !== 'money') return false;
  const was = labelOfOldFigure(s);
  const label = labelWords(pieceLabel(piece)).filter((w) => !MONEY_WORDS.has(w));
  const said = labelWords(piece.replace(/[$€£]?\d[\d,.]*/g, ' '));
  if (!was.length || !label.length || said.some((w) => was.some((x) => sameWord(w, x)))) return false;
  const raws = valueMentions(piece).filter((m) => m.kind === 'money' && m.value === s.value).map((m) => m.raw);
  return raws.length > 0 && raws.every((raw) => {
    const at = piece.indexOf(raw);
    const left = piece.slice(0, at).replace(/[\s(]+$/, '');
    const right = piece.slice(at + raw.length).replace(/^[\s)]+/, '');
    return !SIGN.test(left.slice(-1)) && !SIGN.test(right.charAt(0));
  });
}

/** A piece as a message quotes it: no JSON key or quoting around it. */
function quotable(piece: string): string {
  const t = piece
    .replace(/^[\s{[,]*"?[\w ]{1,40}"\s*:\s*"/, '')
    .replace(/"\s*[,}\]]*\s*$/, '')
    .replace(/\\"/g, '"')
    .trim();
  return t.length > 200 ? `${t.slice(0, 197)}…` : t;
}

/**
 * Sentences that carry on reporting what the one before them set aside, in the
 * same paragraph: "Earlier planning choices no longer apply. These include the
 * $8,000 migration price." (9 Nov, production: the list the sponsor asked for,
 * of what was superseded, failed two repairs.)
 */
function carriesOnReporting(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    let reporting = false;
    for (const sentence of sentencesOf(line)) {
      const carries = reporting && /^\W*(?:these|those|they|such)\b/i.test(sentence);
      if (carries) out.add(sentence);
      reporting = carries || ATTRIBUTED.test(sentence);
    }
  }
  return out;
}

/** One superseded value a text still states as current, and a sentence that states it. */
export interface LeftoverMention {
  value: SupersededValue;
  sentence: string;
}

/**
 * The superseded values `text` still states as current, each with the
 * sentences that state it. A sentence that names the old value beside the new
 * one ("moved from November 12 to November 19") or the repair's own "What
 * changed:" line describes the change; it is not a value left behind.
 *
 * An amount the text works out as a result (`derivedValues` of `derivedIn`,
 * the whole document the text is part of) is a figure of its own that may
 * equal an old one: "$1,200 − $800 = $400" is what is left to spend, not the
 * $400 reserve the $800 replaced. A mention of it is left behind only where
 * it sits beside the words of what the fact changed ("a $400 minimum reserve").
 */
export function leftoverMentions(
  text: string,
  superseded: readonly SupersededValue[],
  options: { derivedIn?: string } = {}
): LeftoverMention[] {
  if (!superseded.length) return [];
  const derived = derivedValues(options.derivedIn ?? text);
  // A list under a line that sets values aside ("The following alternatives
  // are excluded:") is that line's: each item reports a value, it does not
  // state it (8 Oct, production: "- $18 per user per month price").
  const lines = withoutQuotations(text.replace(/\\n/g, '\n')).split('\n');
  let underAttribution = false;
  // Under a markdown heading that records history, until the next heading.
  let inHistory = false;
  // A table whose header names history ("| Type | Item | Detail | Date / status |"
  // under "Decision and change log"): handled by the heading; a table header
  // row that itself says "superseded" or "history" marks the table.
  let historyTable = false;
  const kept = lines.filter((line, i) => {
    const t = line.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(t) ?? /^\*\*([^*]+)\*\*:?$/.exec(t);
    if (heading) {
      inHistory = HISTORY_HEADING.test(heading[1]);
      historyTable = false;
      return !inHistory;
    }
    if (inHistory) return false;
    if (t.startsWith('|')) {
      if (HISTORY_HEADING.test(t) && /\|\s*:?-{2,}/.test(lines[i + 1] ?? '')) historyTable = true;
      if (historyTable) return false;
    } else if (t) {
      historyTable = false;
    }
    if (/:\s*$/.test(t)) {
      underAttribution = ATTRIBUTED.test(t);
      return !underAttribution;
    }
    if (underAttribution && (/^([-*+]|\d+[.)])\s/.test(t) || (t && t.length < 80 && !/[.!?]$/.test(t)))) return false;
    if (t) underAttribution = false;
    return true;
  });
  const pieces = sentencesOf(kept.join('\n'));
  const reported = carriesOnReporting(kept);
  // Rows of a table are serialised as JSON: a key before a colon is not a label.
  const labelled = !/^\s*[[{]/.test(text);
  const out: LeftoverMention[] = [];
  for (const s of superseded) {
    const now = factValues(s.now)[s.kind].filter((v) => v !== s.value);
    const spanned = s.kind === 'dates' && new RegExp(RANGE.source, 'i').test(s.was);
    const coincident = (s.kind === 'money' || s.kind === 'numbers') && derived.has(s.value);
    // Its own label when it had one: "migration", not every word of a list of prices.
    const ownLabel = coincident && s.kind === 'money' ? labelOfOldFigure(s) : [];
    const subject = coincident ? (ownLabel.length ? ownLabel : subjectWords(s.now)) : [];
    for (const raw of pieces) {
      const p = withoutEmphasis(raw);
      if (/^\W*what changed\b/i.test(p) || ATTRIBUTED.test(p) || reported.has(raw)) continue;
      const found = factValues(s.kind === 'dates' && !spanned ? p.replace(RANGE, ' ') : p)[s.kind];
      if (!found.includes(s.value) || now.some((v) => found.includes(v))) continue;
      // A figure the document works out is its own; only beside the fact's
      // own words is it the replaced one. A fact naming nothing is read strictly.
      if (coincident && subject.length && !boundToSubject(p, s, subject)) continue;
      if (labelled && aboutSomethingElse(p, s)) continue;
      out.push({ value: s, sentence: quotable(raw) });
    }
  }
  return out;
}

/**
 * Each value left behind with the sentences that state it, as a message
 * names it: "$400 in "Keep a $400 reserve."". The line, not the fact — the
 * fact alone read as the sentence rejected (2 Nov, Sean: "it rejects the
 * historical mention itself").
 */
export function namedLeftovers(mentions: readonly LeftoverMention[], perValue = 2): { value: SupersededValue; text: string }[] {
  const groups = new Map<SupersededValue, string[]>();
  for (const m of mentions) {
    const list = groups.get(m.value) ?? [];
    if (!list.includes(m.sentence)) list.push(m.sentence);
    groups.set(m.value, list);
  }
  return [...groups].map(([value, sentences]) => ({
    value,
    text: `${describeValue(value)} in ${sentences.slice(0, perValue).map((s) => `"${s}"`).join(' and ')}${sentences.length > perValue ? ` (and ${sentences.length - perValue} more)` : ''}`,
  }));
}

/** The superseded values `text` still states as current (`leftoverMentions`, one per value). */
export function leftoverValues(
  text: string,
  superseded: readonly SupersededValue[],
  options: { derivedIn?: string } = {}
): SupersededValue[] {
  const seen = new Set<SupersededValue>();
  for (const m of leftoverMentions(text, superseded, options)) seen.add(m.value);
  return superseded.filter((s) => seen.has(s));
}

/** "November 12" for "11-12", "$12" for money — how a message names a value. */
export function describeValue(s: Pick<SupersededValue, 'kind' | 'value'>): string {
  if (s.kind === 'dates') {
    const [m, d] = s.value.split('-').map(Number);
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${names[m - 1] ?? m} ${d}`;
  }
  if (s.kind === 'weekdays') return s.value.charAt(0).toUpperCase() + s.value.slice(1);
  if (s.kind === 'times') {
    const [h, m] = s.value.split(':').map(Number);
    if (h === 12 && m === 0) return 'noon';
    const half = h >= 12 ? 'p.m.' : 'a.m.';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${half}`;
  }
  if (s.kind === 'limits') {
    const [u, n] = s.value.split(':');
    return `at most ${n} ${u}${n === '1' ? '' : 's'}`;
  }
  return s.kind === 'money' ? `$${s.value}` : s.value;
}
