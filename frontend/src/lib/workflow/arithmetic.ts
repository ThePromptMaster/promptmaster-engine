/**
 * Sums a document works out on one line, recomputed (8 Nov; "Check the saved
 * package's budget arithmetic"). Deterministic and narrow: `a + b = c`,
 * `a − b = c`, `a × b = c`, `a ÷ b = c` and chains of one kind of step, read
 * left to right, allowing a word or two after a figure ("$43,000 fixed + $8,000
 * training = $51,000"). Anything else on a line is left alone. Pure.
 *
 * A scale said after a figure is part of it (12 Nov). "$3.5 million − $600,000
 * = $2.9 million" was read as 3.5 − 600,000, reported as "works out to
 * -599,996.5, not 2.9", and a workflow that ends a round on this check went
 * round again for it each time. A sum is a slip only when it is wrong read
 * both ways: with the scales, and as the bare figures ("$3.5 million − $0.6
 * million = 2.9" leaves the unit unsaid and is right).
 */

const FIGURE = /(?<![\w.,/-])([$€£])?\s?(\d[\d,]*(?:\.\d+)?)(?![\d%/:-]|,\d)/y;
const SCALE_WORD = /\s?(thousand|million|billion|trillion)\b/iy;
/** A bare letter is a scale only on a money figure: "$195k", "$3.5m". "5 m" is metres. */
const SCALE_LETTER = /(k|m|mn|bn)\b/iy;
const SCALES: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, trillion: 1e12 };
const OPERATOR = /\s*([+−–×x*÷/]|\s-\s)\s*/y;
const WORD = /\s+[A-Za-z][A-Za-z'-]*/y;
const MAX_WORDS = 3;

const norm = (raw: string) => Number(raw.replace(/,/g, ''));

/** The scale written straight after a figure that ends at `at`, and where it ends. */
function scaleAt(line: string, at: number, money: boolean): { factor: number; end: number } | null {
  for (const re of money ? [SCALE_WORD, SCALE_LETTER] : [SCALE_WORD]) {
    re.lastIndex = at;
    const found = re.exec(line);
    if (found) return { factor: SCALES[found[1].toLowerCase()], end: re.lastIndex };
  }
  return null;
}

interface Chain {
  /** The figures as written. */
  values: number[];
  /** The figures with the scale said after each ("3.5 million" is 3,500,000). */
  scaled: number[];
  ops: string[];
  /** Whether any figure carried a scale. */
  anyScale: boolean;
}

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
function chainFrom(line: string, start: number, end: number): Chain | null {
  const values: number[] = [];
  const scaled: number[] = [];
  const ops: string[] = [];
  let anyScale = false;
  let at = start;
  for (;;) {
    FIGURE.lastIndex = at;
    const num = FIGURE.exec(line);
    if (!num) return null;
    const value = norm(num[2]);
    at = FIGURE.lastIndex;
    const scale = scaleAt(line, at, Boolean(num[1]));
    if (scale && scale.end <= end) {
      at = scale.end;
      anyScale = true;
    }
    values.push(value);
    scaled.push(value * (scale && scale.end <= end ? scale.factor : 1));
    for (let words = 0; words < MAX_WORDS; words += 1) {
      WORD.lastIndex = at;
      const w = WORD.exec(line);
      // "x" between figures is a times sign, not a word.
      if (!w || /^\s+x$/i.test(w[0])) break;
      at = WORD.lastIndex;
    }
    if (line.slice(at, end).trim() === '') return values.length > 1 ? { values, scaled, ops, anyScale } : null;
    OPERATOR.lastIndex = at;
    const op = OPERATOR.exec(line);
    if (!op) return null;
    ops.push(opOf(op[1]));
    at = OPERATOR.lastIndex;
  }
}

const off = (worked: number, said: number, rounding = 0) => Math.abs(worked - said) > Math.max(0.01, Math.abs(said) * 0.005, rounding);
const shown = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** The lines whose working does not come to the result they state, each with what it does come to. */
export function arithmeticSlips(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*|__/g, '').replace(/\|/g, ' ; ');
    for (const eq of line.matchAll(/=/g)) {
      const end = eq.index!;
      const rest = line.slice(end + 1);
      const after = /^\s*([$€£])?\s?(\d[\d,]*(?:\.\d+)?)(?![\d%])/.exec(rest);
      if (!after) continue;
      // Each place a sum could start, nearest the equals sign last: the longest chain wins.
      const clause = Math.max(line.lastIndexOf(';', end), line.lastIndexOf(':', end), line.lastIndexOf('=', end - 1), line.lastIndexOf('(', end)) + 1;
      let chain: Chain | null = null;
      for (let start = clause; start < end && !chain; start += 1) {
        if (!/[$€£\d]/.test(line[start])) continue;
        if (start > 0 && /[\d.,]/.test(line[start - 1])) continue;
        chain = chainFrom(line, start, end);
      }
      if (!chain) continue;
      const plain = compute(chain.values, chain.ops);
      const stated = norm(after[2]);
      if (plain === null || !Number.isFinite(plain)) continue;
      if (!off(plain, stated)) continue;
      const resultScale = scaleAt(rest, after[0].length, Boolean(after[1]));
      let worked = plain;
      let said = stated;
      if (chain.anyScale || resultScale) {
        const factor = resultScale?.factor ?? 1;
        worked = compute(chain.scaled, chain.ops) ?? NaN;
        said = stated * factor;
        // "$2.6 million" is good to its last digit: half of that either way is rounding, not a slip.
        const decimals = (after[2].split('.')[1] ?? '').length;
        const rounding = resultScale ? ((0.5 * factor) / 10 ** decimals) * (1 + 1e-9) : 0;
        if (!Number.isFinite(worked) || !off(worked, said, rounding)) continue;
      }
      out.push(`"${raw.trim().slice(0, 160)}" works out to ${shown(worked)}, not ${shown(said)}`);
    }
  }
  return [...new Set(out)].slice(0, 6);
}
