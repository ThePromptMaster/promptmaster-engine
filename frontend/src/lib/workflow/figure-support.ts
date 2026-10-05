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

/** The quantitative figures in `content` that none of `sources` contains. */
export function unsupportedFigures(content: string, sources: readonly string[]): string[] {
  const known = new Set<string>();
  for (const s of sources) for (const n of numbersIn(s)) known.add(n);
  const out: string[] = [];
  for (const f of figuresIn(content)) {
    if (!f.quantitative) continue;
    // A plain decimal (6.1) may be written as any kind in the source.
    const supported = (n: string) =>
      known.has(`${n}|${f.kind}`) || (f.kind === 'plain' && (known.has(`${n}|percent`) || known.has(`${n}|money`)));
    if (f.numbers.every(supported)) continue;
    if (ASSUMPTION.test(sentenceAround(content, f.at))) continue;
    if (!out.includes(f.text)) out.push(f.text);
  }
  return out;
}

/** Everything a stage's figures may legitimately come from: the project, its data and the other stages. */
export function figureSources(
  project: Pick<Project, 'objective' | 'constraints' | 'audience' | 'output_format' | 'context' | 'data_files'>,
  bundles: Record<string, StageArtifactBundle>,
  stageId: string
): string[] {
  const sources = [project.objective, project.constraints, project.audience, project.output_format, project.context ?? ''];
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
