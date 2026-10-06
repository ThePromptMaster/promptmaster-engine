/**
 * A long first message is a brief, not an objective (4 Oct, item 7).
 *
 * A board-level turnaround brief — the company, its figures, the board's
 * question — was pasted as the objective and refused at the objective's
 * limit. The objective is what every stage is judged against, so it should be
 * a few sentences; the rest is source material. A short ask is the objective
 * as it stands. A long one becomes the project context in full, and its
 * opening paragraph is offered as the objective for the user to edit.
 */

/** Past this, a first message is treated as a brief. */
export const BRIEF_FROM_CHARS = 1_500;
/**
 * …and past this, if it is laid out as one: a title, the ask, then facts.
 * A 1,356-character board brief with nine bullet points stayed whole as the
 * objective on the production pass (6 Oct).
 */
export const STRUCTURED_BRIEF_FROM_CHARS = 600;
const STRUCTURED_PARAGRAPHS = 3;
/** The objective drawn from a brief is at most this long. */
export const DRAWN_OBJECTIVE_MAX = 1_200;
/** Kept in step with MAX_CONTEXT_CHARS in backend/promptmaster/limits.py. */
export const MAX_CONTEXT_CHARS = 60_000;

export interface SplitAsk {
  objective: string;
  context: string;
}

export function splitAsk(text: string): SplitAsk {
  const ask = text.trim();
  const paragraphs = ask.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const isBrief =
    ask.length > BRIEF_FROM_CHARS ||
    (ask.length > STRUCTURED_BRIEF_FROM_CHARS && paragraphs.length >= STRUCTURED_PARAGRAPHS);
  if (!isBrief) return { objective: ask, context: '' };

  // The first paragraph that reads as a sentence, not a title line.
  const opening = paragraphs.find((p) => p.length >= 80 || /[.?!]$/.test(p)) ?? paragraphs[0] ?? ask;
  let objective = opening;
  if (objective.length > DRAWN_OBJECTIVE_MAX) {
    const cut = objective.slice(0, DRAWN_OBJECTIVE_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    objective = end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return { objective, context: ask.slice(0, MAX_CONTEXT_CHARS) };
}
