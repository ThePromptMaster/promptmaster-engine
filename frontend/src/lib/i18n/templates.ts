import type { Locale } from './locales';
import { DICTIONARIES } from './translate';
import type { StageDefinition, StageGroup } from '@/lib/workflow/types';
import type { StageItemSchema } from '@/lib/workflow/stage-artifact';

/**
 * A system workflow's words in the interface's language (client, 21 Oct:
 * "pick your language"). The template in the database stays English — it is
 * what prompts are built from — and is the fallback: a custom workflow, or a
 * stage this table does not know, shows its own words.
 */
type StageField = 'label' | 'short' | 'guidance';
const FIELD: Record<StageField, keyof Pick<StageDefinition, 'label' | 'short_label' | 'entry_guidance'>> = {
  label: 'label',
  short: 'short_label',
  guidance: 'entry_guidance',
};

function look(locale: Locale, key: string): string | undefined {
  if (locale === 'en') return undefined;
  return (DICTIONARIES[locale] as Record<string, string>)[key];
}

export function stageText(
  locale: Locale,
  templateKey: string | null | undefined,
  stage: Pick<StageDefinition, 'id' | 'label' | 'short_label' | 'entry_guidance'>,
  field: StageField
): string {
  const own = stage[FIELD[field]] ?? '';
  if (!templateKey) return own;
  return look(locale, `stage.${templateKey}.${stage.id}.${field}`) ?? own;
}

export function templateDescription(locale: Locale, templateKey: string | null | undefined, own: string): string {
  return (templateKey && look(locale, `template.${templateKey}.description`)) || own;
}

export function groupLabel(locale: Locale, group: StageGroup, own: string): string {
  return look(locale, `group.${group}`) ?? own;
}

/** What a workflow makes ("book", "research report"), in the interface's language; a custom one as written. */
export function nounText(locale: Locale, noun: string): string {
  return look(locale, `noun.${noun}`) ?? noun;
}

/** Its parts, plural ("chapters", "sections"); unknown ones get an English "s". */
export function unitsText(locale: Locale, unit: string): string {
  return (DICTIONARIES[locale] as Record<string, string>)[`units.${unit}`] ?? `${unit}s`;
}

/** A system workflow's name ("Book", "Livre"); a custom one as written. */
export function workflowName(locale: Locale, templateKey: string | null | undefined, own: string): string {
  return (templateKey && look(locale, `workflow.name.${templateKey}`)) || own;
}

/**
 * A system workflow's own words in the interface's language — an exit
 * criterion, a hint, a skip reason, a table column, a status and its legend, a
 * mode tagline — looked up by the English itself (`messages/areas/words.ts`).
 * Anything not in the table (a custom workflow's words, text the user wrote)
 * comes back as written. The English stays what is stored and sent to the model.
 */
export function templateWord(locale: Locale, english: string): string;
export function templateWord(locale: Locale, english: string | undefined): string | undefined;
export function templateWord(locale: Locale, english: string | undefined): string | undefined {
  if (!english) return english;
  return look(locale, `tw:${english}`) ?? english;
}

/** A table's item noun in the plural ("claims", "afirmaciones"); English adds an "s", as it always has. */
export function itemPlural(locale: Locale, noun: string): string {
  return look(locale, `twp:${noun}`) ?? `${noun}s`;
}

/**
 * A table's schema as the screen shows it: item noun, column names and hints,
 * the decision question, the default-state note, status names and legends in
 * the interface's language. Keys, values and limits are untouched, so a row
 * saved through it is the row the English schema describes.
 */
export function shownSchema<T extends StageItemSchema>(locale: Locale, schema: T): T {
  if (locale === 'en') return schema;
  return {
    ...schema,
    itemLabel: templateWord(locale, schema.itemLabel),
    decisionQuestion: templateWord(locale, schema.decisionQuestion),
    defaultStateNote: templateWord(locale, schema.defaultStateNote),
    fields: schema.fields.map((f) => ({ ...f, label: templateWord(locale, f.label), hint: templateWord(locale, f.hint) })),
    statuses: schema.statuses?.map((s) => ({ ...s, label: templateWord(locale, s.label), explain: templateWord(locale, s.explain) })),
  };
}
