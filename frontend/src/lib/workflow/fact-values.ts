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

export interface FactValues {
  /** "11-12" for November 12, however it is written; the year is not part of it. */
  dates: string[];
  /** "12" for $12, $12.00, 12 USD. */
  money: string[];
  /** Other numbers, commas removed; years and the parts of dates and amounts excluded. */
  numbers: string[];
}

const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const amount = (raw: string) => {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : raw.replace(/,/g, '');
};

export function factValues(text: string): FactValues {
  const dates = new Set<string>();
  const money = new Set<string>();
  let rest = text;
  const take = (re: RegExp, add: (m: RegExpExecArray) => void) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      add(m);
      return ' ';
    });
  };
  take(MONTH_DAY, (m) => dates.add(`${month(m[1])}-${Number(m[2])}`));
  take(DAY_MONTH, (m) => dates.add(`${month(m[2])}-${Number(m[1])}`));
  take(NUMERIC_DATE, (m) => {
    if (Number(m[1]) <= 12 && Number(m[2]) <= 31) dates.add(`${Number(m[1])}-${Number(m[2])}`);
  });
  take(MONEY, (m) => money.add(amount(m[1] ?? m[2])));
  const numbers = new Set(
    (rest.match(NUMBER) ?? []).map((n) => n.replace(/,/g, '')).filter((n) => !/^(19|20)\d\d$/.test(n))
  );
  return { dates: [...dates], money: [...money], numbers: [...numbers] };
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
  const was = factValues(oldStatement);
  const now = factValues(newStatement);
  const out: SupersededValue[] = [];
  for (const kind of ['dates', 'money', 'numbers'] as const) {
    for (const value of was[kind]) {
      if (!now[kind].includes(value)) out.push({ kind, was: oldStatement, now: newStatement, value });
    }
  }
  return out;
}

/**
 * The superseded values `text` still states as current. A sentence that names
 * the old value beside the new one ("moved from November 12 to November 19")
 * or the repair's own "What changed:" line describes the change; it is not a
 * value left behind.
 */
export function leftoverValues(text: string, superseded: readonly SupersededValue[]): SupersededValue[] {
  if (!superseded.length) return [];
  const pieces = text
    .replace(/\\n/g, '\n')
    .split(/(?<=[.!?;])\s+|\s*\n\s*|",\s*"/)
    .map((p) => p.trim())
    .filter(Boolean);
  return superseded.filter((s) => {
    const now = factValues(s.now)[s.kind].filter((v) => v !== s.value);
    return pieces.some((p) => {
      if (/^\W*what changed\b/i.test(p)) return false;
      const found = factValues(p)[s.kind];
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
  return s.kind === 'money' ? `$${s.value}` : s.value;
}
