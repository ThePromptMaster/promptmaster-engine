import type { Locale } from './locales';
import { DICTIONARIES } from './translate';
import type { StageDefinition, StageGroup } from '@/lib/workflow/types';

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
