/**
 * An answer to Go's question is a decision of record (8 Oct; Sean, emails 8
 * and 11).
 *
 * "Answer and continue" used to be saved only as a step of the run. Drafting
 * read it, because the next revision was handed it; evaluation, the final
 * review and the objective check did not, because they read the project's
 * facts. So December 10 and $18 were "already decided by the user" in the
 * draft and an "unresolved combination" in the evaluation, and Summary went on
 * waiting for two answers it had been given. The answer now becomes an
 * accepted fact, which every prompt reads (`project_context.context_block`).
 */
import type { NewFact } from '@/lib/supabase/facts';
import { documentText, type StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

const QUESTION_MAX = 600;
const STATEMENT_MAX = 2_000;

/**
 * "Do whatever is best" on Go's question card (25 Oct, Sean: "this would be a
 * good place for a 'do whatever is best' button"). Sent to the model as the
 * answer; it decides nothing of record itself, so it never becomes a fact —
 * what Go then chooses is in the version it saves.
 */
export const DELEGATED_ANSWER =
  // "say in the result what you chose" (until 4 Nov) put a note to the user
  // into the document itself: "The proposal now ends with section 7 …" (Lakeside v12).
  'Do whatever is best: use your judgement within the objective, the accepted facts and my latest version, and tell me what you chose in your note to me, not in the document.';

export function isDelegatedAnswer(answer: string): boolean {
  return answer.trim() === DELEGATED_ANSWER || /^do (?:whatever|what) (?:is|you think is) best\b/i.test(answer.trim());
}

/**
 * What "Do whatever is best" asks of Go (5 Nov, a research project). Saying so was
 * not enough: the moves after it were checks that never read the answer, Go named
 * its choice once in a rationale, and the document went on saying "Unresolved. The
 * researcher should state both." Now it reopens the stage the question is about,
 * so the next move is the repair, told to decide it.
 */
const DELEGATED_WHY = 'you left this to me: ';

export function delegatedWhy(question: string): string {
  return `${DELEGATED_WHY}"${questionOf(question)}"`;
}

export function isDelegatedWhy(why: string): boolean {
  return why.startsWith(DELEGATED_WHY);
}

/** The question a `delegatedWhy` asked, back out of it. */
export function delegatedQuestion(why: string): string {
  return why.slice(DELEGATED_WHY.length).replace(/^"|"$/g, '');
}

/**
 * Told to the repair. Says "state it as settled", never "remove": asking for a
 * removal switches off the check that puts back what a revision drops unasked.
 */
export const DELEGATED_RULE =
  ' DECIDE IT NOW. The user left this question to you: pick the answer that best serves the objective, the accepted facts and the current text, and state it as settled wherever the text raises it, so that nothing in the document still treats it as open, lists it as unresolved or asks the reader to decide it. Change nothing else. In your note to the user, begin with "Chosen: " and the choice in one sentence, then say why.';

/** "Chosen: …" out of the writer's note to the user; null when it did not say. */
export function chosenFrom(note: string | null | undefined): string | null {
  const m = (note ?? '').match(/\bChosen:\s*([^\n]+?)(?=(?:\s+(?:Why|Because)\b:?)|\n|$)/i);
  const said = m?.[1]?.trim();
  return said ? said.slice(0, 1_000) : null;
}

/** The choice on record, said apart from what the user said: every later check and draft reads it. */
export function delegatedFact(question: string, chosen: string, ref: { run_id: string; stage_id: string; version_id: string }): NewFact {
  const asked = questionOf(question);
  return {
    statement: `Chosen by Go when you left it to Go${asked ? ` — asked "${asked}"` : ''}: ${chosen}`.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    origin: 'model_assumed',
    source_ref: { via: 'go answer', delegated: true, question: asked, ...ref },
  };
}

/** Options only the user can carry out: "I'll attach the paper", "I've checked it". */
const FIRST_PERSON = /^\s*i(?:['’](?:ll|ve|m|d)|\s)/i;

const significant = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))];

/**
 * Whether the question is one the text can settle: most of its words are in the
 * text, and the choices are not all things only the user can do. Otherwise there
 * is nothing to revise, and the planner is told to choose or say what is left.
 */
export function settlesInTheText(question: string, choices: readonly string[] | undefined, text: string): boolean {
  if (!text.trim()) return false;
  if (choices?.length && choices.every((c) => FIRST_PERSON.test(c))) return false;
  const asked = significant(questionOf(question));
  if (!asked.length) return false;
  const here = new Set(significant(text));
  return asked.filter((w) => here.has(w)).length / asked.length >= 0.5;
}
/**
 * Go's sentences about its own buttons and abilities. Not part of what was
 * decided: on 4 Nov (Sean, Lakeside) "There is no button that starts this
 * edit from my side" was recorded with his answer, and every later prompt
 * read it as a fact of the project.
 */
const ABOUT_ITSELF: readonly RegExp[] = [
  /\bno button\b/i,
  /\bpress(?:ing)?\b[^.?!]*\bbutton\b/i,
  /\bpress(?:ing)? ["“][^"”]+["”]/i,
  /\b(?:i|go) (?:cannot|can't|can not|am unable to|have no way to)\b[^.?!]*\b(?:edit|make|start|remove|change|do)\b/i,
  /\bfrom my side\b/i,
];

/** The question as the fact records it: the first paragraph, without the pointer to a button or Go's words about itself. */
export function questionOf(question: string): string {
  const first = question.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const sentences = first.split(/(?<=[.?!])\s+(?=["“'A-Z0-9])/);
  const kept = sentences.filter((s) => !ABOUT_ITSELF.some((re) => re.test(s))).join(' ').trim() || first;
  return kept.length > QUESTION_MAX ? `${kept.slice(0, QUESTION_MAX - 1).trimEnd()}…` : kept;
}

/**
 * The fact an answer records. `null` for an answer that decides nothing
 * ("ok", "go on"): recording "ok" as a fact of the project would be noise
 * that every later prompt reads.
 */
export function answerAsFact(
  question: string,
  answer: string,
  ref: { run_id: string; step_id?: string; stage_id: string; contradicted?: { document: string; quote: string } }
): NewFact | null {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (!text || /^(ok(ay)?|yes|no|go( on| ahead)?|continue|proceed|sure|fine|thanks?( you)?)[.!]*$/i.test(text)) return null;
  if (isDelegatedAnswer(text)) return null;
  const asked = questionOf(question);
  const statement = asked
    ? `Decided by the user — asked "${asked}", answered: ${text}`
    : `Decided by the user: ${text}`;
  return {
    statement: statement.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    source_ref: { via: 'go answer', question: asked, ...ref },
  };
}

/**
 * The fact a decision made on an approval records (12 Nov): which option the
 * user chose, beside the approval it gives. `via` is the same as an answer's,
 * so the stage it was decided on is left to Go's own revision and is not
 * reopened a second time by the change check (`answeredOnStages`).
 */
export function decisionAsFact(
  approval: string,
  stageLabel: string,
  choice: string,
  ref: { criterion_id: string; stage_id: string; version_id?: string | null; run_id?: string | null }
): NewFact | null {
  const text = choice.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const on = approval.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '');
  const statement = `Decided by the user — on "${on}"${stageLabel ? ` (${stageLabel})` : ''}: ${text}`;
  return {
    statement: statement.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    source_ref: { via: 'go answer', question: on, choice: text.slice(0, 400), ...ref },
  };
}

/**
 * The fact an answer to a review finding records (12 Nov): the user's own
 * words on the row, so every later prompt reads them and not only the table.
 * `via` is an answer's, so the table it was given on is not reopened for it.
 */
export function rowAnswerAsFact(
  finding: string,
  stageLabel: string,
  answer: string,
  ref: { stage_id: string; row_id: string; run_id?: string | null }
): NewFact | null {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const about = questionOf(finding);
  const statement = `Decided by the user — on the finding "${about}"${stageLabel ? ` (${stageLabel})` : ''}: ${text}`;
  return {
    statement: statement.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    source_ref: { via: 'go answer', question: about, ...ref },
  };
}

/**
 * The fact an answer given from the list of what is waiting records (12 Nov).
 * Unlike an answer to a stop, a bare "Yes" or "None" is recorded: the question
 * is beside it. It names the kept questions it answers and the rows it
 * settles, so each is closed by the same fact.
 */
export function queueAnswerAsFact(
  question: string,
  answer: string,
  ref: { stage_id: string; run_id?: string | null; kept_step_ids?: string[]; row_ids?: string[] }
): NewFact | null {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const asked = questionOf(question);
  return {
    statement: `Decided by the user — asked "${asked}", answered: ${text}`.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    source_ref: { via: 'go answer', question: asked, ...ref },
  };
}

/** Per stage, at most this much of its latest saved text goes to the answer check (L-65). */
const ANSWER_DOC_MAX = 20_000;
const ANSWER_DOCS_MAX = 120_000;

/**
 * The saved documents an answer is read against (L-65): every stage's latest
 * saved version, as text, in workflow order, within a budget.
 */
export function answerDocuments(
  template: WorkflowTemplate,
  bundles: Record<string, StageArtifactBundle>
): { label: string; version: number | null; text: string }[] {
  const out: { label: string; version: number | null; text: string }[] = [];
  let used = 0;
  for (const stage of template.stages) {
    const head = bundles[stage.id]?.versions.at(-1);
    const text = documentText(stage, head?.content ?? '').slice(0, ANSWER_DOC_MAX);
    if (!text.trim() || used + text.length > ANSWER_DOCS_MAX) continue;
    used += text.length;
    out.push({ label: stage.label, version: head?.version_number ?? null, text });
  }
  return out;
}

/**
 * What the project's own code measured, as one more document for the answer
 * check (L-65). A count is not a sentence any document says, so "the
 * announcement already has 120 words" could not be contradicted by a quote;
 * on production it went through, while the saved announcement measured 99.
 */
export function measuredDocument(
  template: WorkflowTemplate,
  measured: Readonly<Record<string, readonly { label: string; satisfied: boolean; detail?: string }[]>>
): { label: string; version: null; text: string }[] {
  const lines = template.stages.flatMap((s) =>
    (measured[s.id] ?? []).map((m) => `${s.label}: ${m.label} — measured ${m.detail ?? 'met'}`)
  );
  return lines.length ? [{ label: 'Measured in code', version: null, text: lines.join('\n') }] : [];
}
