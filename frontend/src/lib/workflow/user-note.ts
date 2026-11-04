/**
 * A note to the user never stays at the end of the work (4 Nov, Sean,
 * Lakeside proposal). Pure.
 *
 * The stage writer was told to say things to the user "in a reply" — what
 * approval covers, that figures were worked by hand, that no further pass is
 * needed — and its only output was the document. So every revision Go saved
 * ended with a block addressed to him ("Notes for you, outside the proposal:",
 * "Reply to you, not part of the document:"), and each one Go removed came back
 * under a new heading. The backend now gives the writer a place for that note
 * and takes it off (`backend/promptmaster/reader_text.py::split_user_note`);
 * this is the same split, for text that did not pass through it — a draft
 * continued after a cut-off, and versions saved before 4 Nov when they are
 * exported. Both run the same fixtures (`backend/tests/fixtures/user_notes.json`).
 */

const MARKER = /^[ \t]*[*_>#]*[ \t]*={2,}[ \t]*notes?[ \t]+(?:for|to)[ \t]+the[ \t]+user[ \t]*={2,}[ \t*_]*$/im;

/** A line that only separates: a rule, a non-breaking space, a line break, or nothing. */
const SEPARATOR = /^[ \t]*(?:-{3,}|\*{3,}|_{3,}|&nbsp;|<br\s*\/?>|\\)?[ \t]*$/i;
const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,}|&nbsp;|<br\s*\/?>)[ \t]*$/i;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]/;

const DOC = String.raw`(?:document|proposal|report|memo|letter|brief|plan|pack|deliverable|text|work|draft|announcement|email|summary|answer|response)`;

/** The label of a block addressed to the user, at the start of its first line. */
const LABEL = new RegExp(
  String.raw`^(?:(?:internal|private|production|process|workflow)[ \t]+)?notes?[ \t]+(?:for|to)[ \t]+(?:you|the[ \t]+user)\b` +
    String.raw`|^notes?[ \t]+on[ \t]+(?:this|the)[ \t]+(?:version|draft|revision|update|edit|changes?)\b` +
    String.raw`|^(?:a[ \t]+)?(?:reply|message|remarks?)[ \t]+(?:for|to)[ \t]+you\b` +
    String.raw`|^(?:production|process|workflow)[ \t]+notes?\b`,
  'i'
);

/**
 * Labels a document may also use for its own content ("Not part of this
 * proposal: follow-up support"): a note only when the block also says what a
 * note says.
 */
const WEAK_LABEL = new RegExp(
  String.raw`^outside[ \t]+(?:the|this)[ \t]+${DOC}\b` +
    String.raw`|^not[ \t]+part[ \t]+of[ \t]+(?:the|this)[ \t]+${DOC}\b` +
    String.raw`|^status[ \t]+of[ \t]+(?:the|this)[ \t]+(?:results?|work|draft|document)\b`,
  'i'
);

/** What a note to the user says. Two different ones in a block after a closing rule make it a note. */
const SIGNALS = [
  /\bapprov\w*\b[^.\n]{0,80}?\bdo(?:es)?(?:n['’]t|[ \t]+not)[ \t]+authori[sz]e/i,
  /\bno[ \t]+further[ \t]+(?:drafting[ \t]+)?pass\b|\bfurther[ \t]+drafting\b|\bnext[ \t]+pass\b/i,
  /\bby[ \t]+hand\b|\bhand[- ](?:estimate|count|counted|arithmetic)\b|\bnot[ \t]+(?:machine|tool)[- ]counted\b|\bnot[ \t]+computed\b|\bnot[ \t]+counted[ \t]+(?:it[ \t]+)?with[ \t]+a[ \t]+tool\b|\bnot[ \t]+computed[ \t]+by[ \t]+code\b/i,
  /\bword[ \t]+count\b/i,
  /\bunless[ \t]+you[ \t]+change[ \t]+a[ \t]+fact\b/i,
  /\baccepted[ \t]+findings\b|\byour[ \t]+instruction\b/i,
];

/** A note is a few lines, never most of the text. */
const NOTE_MAX = 3_000;

/** The words a line opens with, without Markdown, up to a colon. */
function labelOf(line: string): string {
  const bare = line.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*)?[*_]*/, '').trim();
  const head = bare.slice(0, 100).includes(':') ? bare.split(':', 1)[0] : bare;
  return head.replace(/^[ \t*_]+|[ \t*_]+$/g, '');
}

function labelKind(line: string): 'strong' | 'weak' | null {
  const head = labelOf(line);
  if (!head || head.length > 80) return null;
  // Without a colon the line has to be a label on its own, not a sentence of the work.
  if (!line.slice(0, 110).includes(':') && line.trim().length > 80) return null;
  if (LABEL.test(head)) return 'strong';
  return WEAK_LABEL.test(head) ? 'weak' : null;
}

function signals(text: string): number {
  return SIGNALS.filter((s) => s.test(text)).length;
}

/** Where a note to the user written into the end of the work starts, if one is there. */
function trailingBlock(lines: string[]): number | null {
  let lastHeading = -1;
  lines.forEach((l, i) => {
    if (HEADING.test(l)) lastHeading = i;
  });
  // (a) A labelled block: the first label line with no other heading after it.
  for (let i = Math.max(lastHeading, 0); i < lines.length; i++) {
    const kind = labelKind(lines[i]);
    if (!kind || !lines.slice(0, i).some((l) => l.trim())) continue;
    const block = lines.slice(i).join('\n');
    if (block.length > NOTE_MAX) return null;
    if (kind === 'strong' || signals(block) >= 1) return i;
  }
  // (b) An unlabelled block after a closing rule that says two things only a note says.
  const rules = lines.flatMap((l, i) => (RULE.test(l) && i > lastHeading ? [i] : []));
  if (!rules.length) return null;
  const start = rules[rules.length - 1];
  const body = lines.slice(start + 1).join('\n');
  if (!body.trim() || body.length > NOTE_MAX || !lines.slice(0, start).some((l) => l.trim())) return null;
  return signals(body) >= 2 ? start + 1 : null;
}

/** The work, and the note to the user taken off its end ('' when there is none). */
export function splitUserNote(text: string): { body: string; note: string } {
  if (!text || !text.trim()) return { body: text, note: '' };
  const notes: string[] = [];
  let work = text;
  const m = MARKER.exec(work);
  if (m) {
    notes.push(work.slice(m.index + m[0].length).trim());
    work = work.slice(0, m.index);
  }
  let lines = work.replace(/\s+$/, '').split('\n');
  const start = trailingBlock(lines);
  if (start !== null) {
    let block = lines.slice(start);
    while (block.length && SEPARATOR.test(block[0])) block = block.slice(1);
    notes.unshift(block.join('\n').trim());
    lines = lines.slice(0, start);
  }
  if (!notes.length) return { body: text, note: '' };
  // The rule or blank line that separated the note goes with it.
  while (lines.length && SEPARATOR.test(lines[lines.length - 1])) lines.pop();
  return { body: lines.join('\n').replace(/\s+$/, ''), note: notes.filter(Boolean).join('\n\n') };
}

/** One line for a step or a version's record: what the writer said to the user. */
export function userNoteLine(note: string | null | undefined): string {
  const said = (note ?? '').replace(/\s+/g, ' ').trim();
  return said ? `Kept out of the document, for you: ${said}` : '';
}
