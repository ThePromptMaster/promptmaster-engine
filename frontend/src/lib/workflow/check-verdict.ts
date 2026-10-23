import type { Evaluation } from '@/types/project';
import { effectiveRenderer, rendererHoldsItems } from './stage-artifact';
import type { StageDefinition } from './types';

/**
 * A completeness reason that is about how the rows are laid out, not what they
 * hold: "it covers the content areas but does not present them as the short
 * table the stage asked for" (18 Oct, Theory of Everything). A table stage's
 * rows are stored as items and drawn as a table, so no revision can satisfy
 * it; Go was blocked on it while the bar said "Ready to move on".
 */
const FORMAT = /\b(?:table|tabular|json|list|bullets?|format(?:ted|ting)?|layout|laid out|present(?:ed|s|ation)?)\b/i;
const CONTENT = /\b(?:missing|lacks?|lacking|omit(?:s|ted)?|leaves? out|does not (?:cover|include|address|state|name|give)|no (?:mention|coverage)|absent|incomplete coverage)\b/i;

// The same words in the other offered languages (client, 21 Oct: "pick your
// language"): a Spanish check's reason is in Spanish.
const FORMAT_X = /(?<![\p{L}])(?:tabla|tableau|tabela|tabelle|tabella|tabel|formato|format\p{L}*|lista|liste|lijst|elenco|viñeta\p{L}*|puces|marcadores|aufzählung\p{L}*|opsomming|presentaci\p{L}*|présentation|présenté\p{L}*|apresenta\p{L}*|darstellung|presentazione|presentatie|opmaak|mise en forme)(?![\p{L}])/iu;
const CONTENT_X = /(?<![\p{L}])(?:falta\p{L}*|omit\p{L}*|omet\p{L}*|omis|omess\p{L}*|ausente|assente|absent\p{L}*|manque\p{L}*|manca\p{L}*|fehl\p{L}*|ausgelassen|auslässt|ontbr\p{L}*|weggelaten|laat weg|niet opgenomen|nicht enthalten|no (?:incluye|cubre|menciona)|não (?:inclui|cobre|menciona)|ne (?:couvre|mentionne) pas|n['’]inclut pas|non (?:include|copre|menziona))(?![\p{L}])/iu;

export function formatOnly(stage: StageDefinition, reason: string | null | undefined): boolean {
  const text = (reason ?? '').trim();
  const aboutFormat = FORMAT.test(text) || FORMAT_X.test(text);
  const aboutContent = CONTENT.test(text) || CONTENT_X.test(text);
  return rendererHoldsItems(effectiveRenderer(stage)) && aboutFormat && !aboutContent;
}

/**
 * What the latest check of the current draft says is wrong with it, in words,
 * or null: "incomplete" or "it needs realigning to the objective". Only a
 * check of the head version counts — one about an earlier draft says nothing
 * about this one.
 *
 * One function for Go's move-on gate and for the stage bar's status line, so
 * the bar cannot say "Ready to move on" while Go refuses to (18 Oct, Theory of
 * Everything: "Everything this stage needs is done" under a blocked advance).
 */
export function checkVerdict(
  evaluation: Pick<Evaluation, 'version_id' | 'completeness_status' | 'completeness_reason' | 'needs_realignment'> | null | undefined,
  headId: string | null | undefined,
  stage: StageDefinition
): string | null {
  const e = evaluation;
  if (!e || !headId || e.version_id !== headId) return null;
  const said: string[] = [];
  // A planning stage (a question, a method) is not held to the deliverable's
  // completeness: on production (9 Oct) Method was refused for holding no
  // computed examples — the report's format, which no method contains.
  if (
    (e.completeness_status ?? '').toLowerCase() === 'incomplete' &&
    stage.group !== 'planning' &&
    !formatOnly(stage, e.completeness_reason)
  ) {
    said.push(`it is incomplete${e.completeness_reason ? ` (${e.completeness_reason.trim().replace(/\.$/, '')})` : ''}`);
  }
  if (e.needs_realignment) said.push('it needs realigning to the objective');
  return said.length ? said.join(', and ') : null;
}
