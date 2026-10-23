import { operationLabel } from '@/lib/workflow/labels';
import { getLocale, tr } from './store';
import { DICTIONARIES } from './translate';
import type { MessageKey } from './messages/en';

/**
 * What made a version, as the user reads it (client, 21 Oct: "pick your
 * language"). `operationLabel` stays English: it is also written into history
 * lines and compared by tests. An operation this table does not know reads
 * as `operationLabel` does.
 */
export function shownOperationLabel(operation: string | null | undefined): string {
  if (!operation) return tr('op.draft');
  const key = `op.${operation}`;
  return key in DICTIONARIES[getLocale()] ? tr(key as MessageKey) : operationLabel(operation);
}

function has(key: string): boolean {
  return key in DICTIONARIES[getLocale()];
}

/** A mode's name ("Clarity", "Claridad"); a custom one as written. */
export function shownModeName(mode: string, own: string): string {
  return has(`mode.${mode}`) ? tr(`mode.${mode}` as MessageKey) : own;
}

/** Why a mode suits a system stage, in the interface's language; the template's own words otherwise. */
export function shownModeReason(templateKey: string | null | undefined, stageId: string, mode: string, own: string): string {
  const key = `modeReason.${templateKey}.${stageId}.${mode}`;
  return templateKey && getLocale() !== 'en' && has(key) ? tr(key as MessageKey) : own;
}

/**
 * A stage named by id alone (the project list's badge): the system stage's
 * short name in the interface's language, or the id made readable.
 */
export function shownStageId(templateKey: string | null | undefined, stageId: string): string {
  const key = `stage.${templateKey}.${stageId}.short`;
  return templateKey && getLocale() !== 'en' && has(key) ? tr(key as MessageKey) : stageId.replace(/_/g, ' ');
}
