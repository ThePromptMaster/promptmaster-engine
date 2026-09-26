/**
 * Conflict detection for a typed instruction (PM-24). Pure.
 *
 * Sean, Sep 10: "current instruction vs project objective; current instruction
 * vs prior decision; one instruction vs another; user should be asked which
 * should control when there is a real conflict."
 *
 * Two halves, merged by the caller:
 *
 * - **Here, free and instant:** an instruction's direction on FR-15's closed
 *   vocabulary (combine.ts), read from a small phrase list, against the
 *   constraints, earlier decisions and other pending instructions read the
 *   same way. "Make it much longer" against "Under 300 words" is caught
 *   without a model call, every time.
 * - **The model, for meaning** (`/api/check-conflicts`): conflicts that share
 *   no words. Its answer is filtered to things that were actually listed.
 *
 * Either way nothing is blocked. The user is asked which should control, the
 * answer is recorded on the decision trail, and it rides along with the
 * instruction so the model knows too.
 */

import { CONFLICT_AXES, type ConflictAxis } from './combine';

export type ConflictKind = 'objective' | 'constraint' | 'decision' | 'instruction';

export interface InstructionConflict {
  kind: ConflictKind;
  with_id: string;
  with_text: string;
  explanation: string;
  source: 'rule' | 'model';
}

export interface ConflictSource {
  id: string;
  text: string;
}

/** Phrases that commit an instruction to one direction on an axis. Deliberately short. */
const PHRASES: Record<ConflictAxis, Record<string, RegExp>> = {
  length: {
    shorter: /\b(shorter|shorten|condense|cut (it )?down|trim|more concise|briefer|under \d+ words|no more than \d+ words|keep it (short|brief)|one[- ]page)\b/i,
    longer: /\b(longer|lengthen|expand|elaborate|more detail(ed)?|flesh (it )?out|go deeper into every|add (a )?(long|lengthy|detailed) section)\b/i,
  },
  depth: {
    deeper: /\b(more technical|technical terminology|in depth|in-depth|more rigorous|advanced|(university|graduate|postgraduate|undergraduate)( [a-z]+)? (students|readers|level)|for (experts|specialists|researchers|academics))\b/i,
    shallower: /\b(simpler|simplify|less technical|high[- ]level only|for (a )?beginners?|for children|for kids|(?:[5-9]|1[0-2])[- ]year[- ]olds?)\b/i,
  },
  tone: {
    formal: /\b(more formal|formal tone|academic tone|professional tone)\b/i,
    plain: /\b(casual|informal|conversational|chatty|plain language|friendlier)\b/i,
  },
  scope: {
    broaden: /\b(broaden|widen|also cover|include everything|cover all)\b/i,
    narrow: /\b(narrow|focus only on|only on|stick to|nothing but|exclude)\b/i,
  },
  evidence: {
    more: /\b(more (evidence|sources|citations|references)|cite|add citations|back (it|this) up)\b/i,
    fewer: /\b(no citations|fewer (citations|references)|remove (the )?(citations|references))\b/i,
  },
  structure: {
    more: /\b(add (headings|sections|bullets)|use bullet points|more structure|numbered list)\b/i,
    less: /\b(no (headings|bullets)|flowing prose|less structure|remove (the )?(headings|bullets))\b/i,
  },
};

export function directionsOf(text: string): Map<ConflictAxis, string> {
  const found = new Map<ConflictAxis, string>();
  for (const axis of Object.keys(PHRASES) as ConflictAxis[]) {
    const hits = CONFLICT_AXES[axis].filter((dir) => PHRASES[axis][dir].test(text));
    // A text that says both ("shorter, but with more detail on X") commits to neither.
    if (hits.length === 1) found.set(axis, hits[0]);
  }
  return found;
}

/** Every axis the two texts pull opposite ways on — all of them, so the user is told the whole reason. */
function opposed(instruction: string, other: string): ConflictAxis[] {
  const mine = directionsOf(instruction);
  const theirs = directionsOf(other);
  const out: ConflictAxis[] = [];
  for (const [axis, dir] of mine) {
    const t = theirs.get(axis);
    if (t && t !== dir) out.push(axis);
  }
  return out;
}

function listOf(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const WHAT: Record<ConflictKind, string> = {
  objective: 'the objective',
  constraint: 'the project constraints',
  decision: 'a decision you made earlier',
  instruction: 'another pending instruction',
};

export function ruleConflicts(input: {
  instruction: string;
  objective: string;
  constraints: string;
  decisions: readonly ConflictSource[];
  others: readonly ConflictSource[];
}): InstructionConflict[] {
  const out: InstructionConflict[] = [];
  const check = (kind: ConflictKind, id: string, text: string) => {
    if (!text.trim()) return;
    const axes = opposed(input.instruction, text);
    if (axes.length) {
      out.push({
        kind, with_id: id, with_text: text, source: 'rule',
        explanation: `This instruction pulls the opposite way on ${listOf(axes)} from ${WHAT[kind]}.`,
      });
    }
  };
  check('objective', '', input.objective);
  check('constraint', '', input.constraints);
  input.decisions.forEach((d) => check('decision', d.id, d.text));
  input.others.forEach((o) => check('instruction', o.id, o.text));
  return out;
}

/**
 * The rule's and the model's findings, one per thing conflicted with. The
 * objective and the constraints are asked about once each, however many
 * sentences of them an instruction trips over — the user decides about "the
 * constraints", not about each clause of them.
 *
 * One question, but every reason: when the rule and the model both flag the
 * same thing, the model's explanation of meaning ("the audience is
 * 10-year-olds") leads and the rule's axis follows. Keeping only the first
 * finding once told a user their university-level rewrite clashed on
 * "length" and said nothing of the audience.
 */
export function mergeConflicts(rule: InstructionConflict[], model: InstructionConflict[]): InstructionConflict[] {
  const out: InstructionConflict[] = [];
  const reasons = new Map<InstructionConflict, { model: string[]; rule: string[] }>();
  const byKey = new Map<string, InstructionConflict>();
  for (const c of [...rule, ...model]) {
    const key = c.with_id ? `${c.kind}:${c.with_id}` : c.kind;
    let kept = byKey.get(key);
    if (!kept) {
      kept = { ...c };
      byKey.set(key, kept);
      reasons.set(kept, { model: [], rule: [] });
      out.push(kept);
    }
    const r = reasons.get(kept)!;
    const list = c.source === 'model' ? r.model : r.rule;
    const text = c.explanation.trim();
    if (text && !r.model.includes(text) && !r.rule.includes(text)) list.push(text);
  }
  for (const c of out) {
    const r = reasons.get(c)!;
    c.explanation = [...r.model, ...r.rule].join(' ');
  }
  return out.slice(0, 5);
}

export type Controls = 'new' | 'existing';

export function describeWith(c: InstructionConflict): string {
  return c.kind === 'objective' ? 'the objective' : c.kind === 'constraint' ? 'the constraints' : `"${c.with_text}"`;
}

/**
 * The sentence the model is given with the instruction, so it knows what the
 * user decided — rather than being handed two contradictory orders and left
 * to pick.
 */
export function precedenceNote(c: InstructionConflict, instruction: string, controls: Controls): string {
  const other = describeWith(c);
  return controls === 'new'
    ? `The user has decided this instruction takes precedence over ${other} ("${c.with_text.slice(0, 200)}").`
    : `The user has decided ${other} ("${c.with_text.slice(0, 200)}") takes precedence: apply the instruction only as far as it is consistent with it.`;
}
