/**
 * The instruction a return to an earlier stage carries there (Q2). Pure.
 *
 * 19 Oct (prod pass, FIELDGUIDE copy): Final review held ten accepted fixes,
 * the user chose "Go back to Output and apply the accepted fixes", and the
 * Output revision was sent only that sentence — so it wrote that "the Final
 * review table is not among the documents available to this stage", and the
 * objective check asked the user to paste the rows. A return from a stage that
 * holds rows now carries those rows, as the chat reads them, with the work.
 */

import { itemSchemaFor, parseItems, rendererHoldsItems, stageContentForChat } from '@/lib/workflow/stage-artifact';
import type { StageDefinition } from '@/lib/workflow/types';

/** Rows longer than this are cut; the whole table rides in one prompt. */
const MAX_ROWS_CHARS = 6_000;

/** The returning stage's rows, as the revision reads them, or '' when it holds none. */
export function returningRows(from: StageDefinition, content: string | null | undefined): string {
  if (!rendererHoldsItems(from.renderer)) return '';
  const items = parseItems(content);
  if (!items?.length) return '';
  const text = stageContentForChat(itemSchemaFor(from), content).trim();
  return text.length > MAX_ROWS_CHARS ? `${text.slice(0, MAX_ROWS_CHARS)}\n[…further rows not shown…]` : text;
}

export function returnInstruction(
  from: StageDefinition,
  fromContent: string | null | undefined,
  target: StageDefinition,
  work: string,
): string {
  const rows = returningRows(from, fromContent);
  const lead = `Further investigation asked for by ${from.label}: ${work}`;
  const table = rows
    ? `\n${from.label}'s rows, as saved (apply what they settle or ask for; a row carried forward stays open):\n${rows}`
    : '';
  const keep = rendererHoldsItems(target.renderer)
    ? 'Add a row for each piece of this work that is not already in the table. Keep every existing row, its text and its status exactly as they are.'
    : 'Revise to take this in. Keep everything that still holds exactly as it is.';
  return `${lead}${table}\n${keep}`;
}
