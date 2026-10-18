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
 */
const ATTRIBUTED = /\b(sources?|exclud\w*|conflict\w*|supersed\w*|instead of|replac\w*|previous\w*|earlier|formerly|alternative\w*|no longer|rather than|do not use|don't use|not use|was (?:originally|initially)|histor(?:y|ical)|changed from|originally|request(?:s|ed)?|asks?|asked|declined|rejected|propos(?:al|als|ed|es)|v\d+)\b/i;

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

/**
 * The superseded values `text` still states as current. A sentence that names
 * the old value beside the new one ("moved from November 12 to November 19")
 * or the repair's own "What changed:" line describes the change; it is not a
 * value left behind.
 */
export function leftoverValues(text: string, superseded: readonly SupersededValue[]): SupersededValue[] {
  if (!superseded.length) return [];
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
  text = kept.join('\n');
  const pieces = text
    .replace(/\\n/g, '\n')
    .split(/(?<=[.!?;])\s+|\s*\n\s*|",\s*"/)
    .map((p) => p.trim())
    .filter(Boolean);
  return superseded.filter((s) => {
    const now = factValues(s.now)[s.kind].filter((v) => v !== s.value);
    const spanned = s.kind === 'dates' && new RegExp(RANGE.source, 'i').test(s.was);
    return pieces.some((p) => {
      if (/^\W*what changed\b/i.test(p) || ATTRIBUTED.test(p)) return false;
      const found = factValues(s.kind === 'dates' && !spanned ? p.replace(RANGE, ' ') : p)[s.kind];
      return found.includes(s.value) && !now.some((v) => found.includes(v));
    });
  });
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
