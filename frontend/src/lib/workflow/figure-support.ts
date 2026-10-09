/**
 * Figures must have a source (4 Oct, item 11).
 *
 * A turnaround memo said, correctly, that there was no company-specific
 * baseline and that it would not invent figures — and then gave recovery
 * ranges of 15–25%, 25–45% and 45–65%, and 5/10/15% per option. None of them
 * came from anything the user supplied. Calling them scenarios does not give
 * them a basis.
 *
 * This is a lexical check, by code, not a model's opinion: every quantitative
 * figure in a stage's draft — a percentage, an amount of money, a number with
 * a magnitude (m, bn, k), a decimal, or a range of them — must appear in the
 * project's own material (objective, constraints, context, data files) or in
 * another stage's text. One that does not, and is not labelled as an
 * assumption in its sentence, becomes a finding on the stage check, so it is
 * applied like any other finding — by the user, or by Go's required-work
 * ladder — rather than reaching the final memo.
 *
 * Plain counts ("three plants", "18 months") are not checked: they are too
 * often structural to judge lexically. A figure stated another way in the
 * source ($41.2m against $41,200,000) is reported; the register says so.
 */

import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';
import type { StageArtifactBundle } from './digest';
import { currentFacts } from './facts';

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const CURRENCY = String.raw`[$€£]`;
const UNIT = String.raw`%|percent\b|pp\b|bps\b|x\b|×|bn\b|b\b|mn\b|m\b|k\b|million\b|billion\b|thousand\b`;
/** A figure, or a chain of them sharing a unit: 15–25%, 5/10/15%, $2m to $3m. */
const CHAIN = new RegExp(
  String.raw`(?<![\w.$€£])(${CURRENCY}\s?)?(${NUM})((?:\s?(?:–|—|-|\/|to)\s?${CURRENCY}?\s?${NUM})*)\s?(${UNIT})?`,
  'gi'
);
const ASSUMPTION = /\b(assum|illustrat|hypothetical|placeholder|for example|e\.g\.)/i;

/** A number as compared: commas dropped, a trailing ".0" ignored. */
function norm(n: string): string {
  const plain = n.replace(/,/g, '');
  return plain.includes('.') ? plain.replace(/\.?0+$/, '') : plain;
}

type Kind = 'percent' | 'money' | 'plain';

function kindOf(currency: string | undefined, unit: string | undefined, rest = ''): Kind {
  const u = (unit ?? '').toLowerCase();
  if (u === '%' || u === 'percent' || u === 'pp' || u === 'bps') return 'percent';
  if (currency || /[$€£]/.test(rest) || ['bn', 'b', 'mn', 'm', 'k', 'million', 'billion', 'thousand'].includes(u)) return 'money';
  return 'plain';
}

interface Figure {
  text: string;
  at: number;
  kind: Kind;
  numbers: string[];
  quantitative: boolean;
}

function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(CHAIN)) {
    const [whole, currency, first, rest, unit] = m;
    const numbers = [first, ...(rest.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])].map(norm);
    const kind = kindOf(currency, unit, rest);
    out.push({ text: whole.trim(), at: m.index ?? 0, kind, numbers, quantitative: kind !== 'plain' || /\./.test(numbers.join(' ')) });
  }
  return out;
}

/**
 * Every number written in some text, with what it measures. A percentage is
 * supported by a percentage, money by money: "Plant 15" and "Plant 25" in a
 * brief are not a source for a 15–25% recovery.
 */
export function numbersIn(text: string): Set<string> {
  const known = new Set<string>();
  for (const f of figuresIn(text)) for (const n of f.numbers) known.add(`${n}|${f.kind}`);
  return known;
}

function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('\n', at - 1)) + 1;
  const rest = text.slice(at);
  const end = rest.search(/[.!?](\s|$)|\n/);
  return text.slice(start, end < 0 ? text.length : at + end);
}

/**
 * Mathematics is not a figure. "$2$", "$x_1 = 0.5$" and display equations
 * are LaTeX, and read as money they were flagged "unsupported" (8 Oct, physics
 * review). A span counts as maths when it is $$…$$, \(…\), \[…\], or $…$
 * holding a command, a sub/superscript, braces, an equals sign, or only a
 * number or a variable. "$8,000 and $9,000" is two amounts, not a span.
 */
const MATH = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$(?=\S)([^$\n]{1,300}?)(?<=\S)\$(?!\d)/g;
export function withoutMath(text: string): string {
  return text.replace(MATH, (span, inline: string | undefined) =>
    inline === undefined || /[\\^_{}=]/.test(inline) || /^[\d.]+$|^[A-Za-z]$/.test(inline.trim()) ? ' '.repeat(span.length) : span
  );
}

/** Numbers of each kind a figure may be calculated from, kept small enough to combine. */
const COMBINE_MAX = 40;
const round = (n: number) => norm(String(Math.round(n * 100) / 100));

/**
 * Figures calculated from supplied ones: a sum or difference of two or three
 * amounts or counts of the same kind, or a product of two (8 Oct; Sean's
 * portfolio test: $8,000 and $9,000 were totals of the supplied costs, and
 * the check told him to remove them or call them assumptions).
 */
export function derivedNumbers(known: ReadonlySet<string>): Set<string> {
  const byKind = new Map<string, number[]>();
  for (const key of known) {
    const [n, kind] = key.split('|');
    const v = Number(n);
    if (!Number.isFinite(v)) continue;
    const list = byKind.get(kind) ?? [];
    if (list.length < COMBINE_MAX && !list.includes(v)) list.push(v);
    byKind.set(kind, list);
  }
  const out = new Set<string>();
  for (const [kind, vs] of byKind) {
    // Not percentages: differences and ratios of margins can reach almost any
    // figure, and an invented recovery range (15–25%) is exactly what this
    // check exists to catch (4 Oct).
    if (kind === 'percent') continue;
    for (let i = 0; i < vs.length; i += 1) {
      for (let j = i + 1; j < vs.length; j += 1) {
        out.add(`${round(vs[i] + vs[j])}|${kind}`);
        out.add(`${round(Math.abs(vs[i] - vs[j]))}|${kind}`);
        out.add(`${round(vs[i] * vs[j])}|${kind}`);
        for (let k = j + 1; k < vs.length && vs.length <= 25; k += 1) out.add(`${round(vs[i] + vs[j] + vs[k])}|${kind}`);
      }
    }
  }
  return out;
}

/** The quantitative figures in `content` that none of `sources` contains, or is calculated from. */
export function unsupportedFigures(content: string, sources: readonly string[]): string[] {
  const known = new Set<string>();
  for (const s of sources) for (const n of numbersIn(withoutMath(s))) known.add(n);
  const derived = derivedNumbers(known);
  const out: string[] = [];
  content = withoutMath(content);
  for (const f of figuresIn(content)) {
    if (!f.quantitative) continue;
    // A plain decimal (6.1) may be written as any kind in the source.
    const has = (key: string) => known.has(key) || derived.has(key);
    const supported = (n: string) =>
      has(`${n}|${f.kind}`) || (f.kind === 'plain' && (has(`${n}|percent`) || has(`${n}|money`) || has(`${n}|plain`)));
    if (f.numbers.every(supported)) continue;
    if (ASSUMPTION.test(sentenceAround(content, f.at))) continue;
    if (!out.includes(f.text)) out.push(f.text);
  }
  return out;
}

/** Everything a stage's figures may legitimately come from: the project, its data and the other stages. */
export function figureSources(
  project: Pick<Project, 'objective' | 'constraints' | 'audience' | 'output_format' | 'context' | 'data_files' | 'facts'>,
  bundles: Record<string, StageArtifactBundle>,
  stageId: string
): string[] {
  const sources = [project.objective, project.constraints, project.audience, project.output_format, project.context ?? ''];
  // An accepted fact is supplied material (6 Oct, email 4: figures the user
  // gave were flagged "unsupported" by the final check).
  for (const f of currentFacts(project.facts)) sources.push(f.statement);
  for (const f of project.data_files ?? []) sources.push(JSON.stringify(f.preview ?? {}));
  for (const [id, bundle] of Object.entries(bundles)) {
    if (id === stageId) continue;
    sources.push(bundle?.versions.at(-1)?.content ?? '');
    for (const section of bundle?.artifact?.long_form?.outline ?? []) sources.push(section.content ?? '');
  }
  return sources.filter(Boolean);
}

export const UNSUPPORTED_FIGURES = 'Unsupported figures';
const SHOWN = 8;

/** The finding, or none: one per check, naming the figures. */
export function figureFindings(content: string, sources: readonly string[]): AuditFinding[] {
  const figures = unsupportedFigures(content, sources);
  if (!figures.length) return [];
  const named = figures.slice(0, SHOWN).join(', ') + (figures.length > SHOWN ? `, and ${figures.length - SHOWN} more` : '');
  return [{
    id: 'unsupported-figures',
    category: UNSUPPORTED_FIGURES,
    summary: `${figures.length === 1 ? 'A figure has' : `${figures.length} figures have`} no source in the project: ${named}.`,
    suggested_change:
      'Take each figure from the project context, an earlier stage or a data file, exactly as written there. ' +
      'Where nothing supports one, remove it, or keep it only labelled plainly as an assumption ("Assumption: …").',
  }];
}
