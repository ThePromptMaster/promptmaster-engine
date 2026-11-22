/**
 * Why a stage was reopened, in the user's words (L-277). Pure but for the dictionary.
 *
 * A stage reopened by a change carries the reason Go's repair reads
 * (`stale.reason`, `perform.ts`): an instruction to a model. Shown as it is, a
 * decision set aside read "…keep it only as an earlier decision, say the decision
 * is awaited, and change nothing else", and a later stage carried "Also: … Do not
 * present it as the decision of record". The instruction stays where it is, for
 * Go; this says what happened, for the person. Reasons this code does not know
 * are shown as written.
 */
import { tr } from '@/lib/i18n/store';

const SET_ASIDE = /^the user's decision "([\s\S]+?)" was made when the record said "([\s\S]+?)", which has changed\./;
const DECIDED = /^the user has decided: "([\s\S]+?)"\./;
const STATES = /^It states "([\s\S]+?)", which changed: /;
const LATER = /\s*Also: the user's decision "([\s\S]+?)" is set aside by this change until the user decides again\.[\s\S]*$/;

export function plainReason(reason: string | null | undefined): string {
  let text = (reason ?? '').trim();
  if (!text) return '';
  let later = '';
  const tail = LATER.exec(text);
  if (tail) {
    later = tr('chk.setAsideLater', { option: tail[1] });
    text = text.slice(0, tail.index).trim();
  }
  let said: string;
  const aside = SET_ASIDE.exec(text);
  const decided = DECIDED.exec(text);
  const states = STATES.exec(text);
  if (aside) said = tr('chk.setAside', { option: aside[1], because: aside[2] });
  else if (decided) said = tr('chk.decidedIn', { option: decided[1] });
  else if (states) said = tr('chk.statesFact', { fact: states[1] });
  else said = text.length > 300 ? `${text.slice(0, 299).trimEnd()}…` : text;
  return later ? `${said} ${later}` : said;
}
