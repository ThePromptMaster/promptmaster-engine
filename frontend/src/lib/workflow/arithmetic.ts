/**
 * Sums a document works out on one line, recomputed (8 Nov; "Check the saved
 * package's budget arithmetic"). Deterministic and narrow: `a + b = c`,
 * `a − b = c`, `a × b = c`, `a ÷ b = c` and chains of one kind of step, read
 * left to right, allowing a word or two after a figure ("$43,000 fixed + $8,000
 * training = $51,000"). Anything else on a line is left alone. Pure.
 */

const FIGURE = /(?<![\w.,/-])[$€£]?\s?(\d[\d,]*(?:\.\d+)?)(?![\d%/:-]|,\d)/y;
const OPERATOR = /\s*([+−–×x*÷/]|\s-\s)\s*/y;
const WORD = /\s+[A-Za-z][A-Za-z'-]*/y;
const MAX_WORDS = 3;

const norm = (raw: string) => Number(raw.replace(/,/g, ''));

function compute(values: readonly number[], ops: readonly string[]): number | null {
  const adds = ops.some((o) => o === '+' || o === '-');
  const multiplies = ops.some((o) => o === '*' || o === '/');
  if (adds && multiplies) return null;
  return ops.reduce((total, op, i) => {
    const next = values[i + 1];
    return op === '+' ? total + next : op === '-' ? total - next : op === '*' ? total * next : next === 0 ? NaN : total / next;
  }, values[0]);
}

const opOf = (raw: string) => (raw === '+' ? '+' : /[−–-]/.test(raw) ? '-' : /[×x*]/.test(raw) ? '*' : '/');

/** A chain that ends exactly where this equals sign is, read from `start`. */
function chainFrom(line: string, start: number, end: number): { values: number[]; ops: string[] } | null {
  const values: number[] = [];
  const ops: string[] = [];
  let at = start;
  for (;;) {
    FIGURE.lastIndex = at;
    const num = FIGURE.exec(line);
    if (!num) return null;
    values.push(norm(num[1]));
    at = FIGURE.lastIndex;
    for (let words = 0; words < MAX_WORDS; words += 1) {
      WORD.lastIndex = at;
      const w = WORD.exec(line);
      // "x" between figures is a times sign, not a word.
      if (!w || /^\s+x$/i.test(w[0])) break;
      at = WORD.lastIndex;
    }
    if (line.slice(at, end).trim() === '') return values.length > 1 ? { values, ops } : null;
    OPERATOR.lastIndex = at;
    const op = OPERATOR.exec(line);
    if (!op) return null;
    ops.push(opOf(op[1]));
    at = OPERATOR.lastIndex;
  }
}

/** The lines whose working does not come to the result they state, each with what it does come to. */
export function arithmeticSlips(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*|__/g, '').replace(/\|/g, ' ; ');
    for (const eq of line.matchAll(/=/g)) {
      const end = eq.index!;
      const after = /^\s*[$€£]?\s?(\d[\d,]*(?:\.\d+)?)(?![\d%])/.exec(line.slice(end + 1));
      if (!after) continue;
      // Each place a sum could start, nearest the equals sign last: the longest chain wins.
      const clause = Math.max(line.lastIndexOf(';', end), line.lastIndexOf(':', end), line.lastIndexOf('=', end - 1), line.lastIndexOf('(', end)) + 1;
      let chain: ReturnType<typeof chainFrom> = null;
      for (let start = clause; start < end && !chain; start += 1) {
        if (!/[$€£\d]/.test(line[start])) continue;
        if (start > 0 && /[\d.,]/.test(line[start - 1])) continue;
        chain = chainFrom(line, start, end);
      }
      if (!chain) continue;
      const worked = compute(chain.values, chain.ops);
      const stated = norm(after[1]);
      if (worked === null || !Number.isFinite(worked)) continue;
      if (Math.abs(worked - stated) > Math.max(0.01, Math.abs(stated) * 0.005)) {
        out.push(`"${raw.trim().slice(0, 160)}" works out to ${worked.toLocaleString('en-US', { maximumFractionDigits: 2 })}, not ${stated.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      }
    }
  }
  return [...new Set(out)].slice(0, 6);
}
