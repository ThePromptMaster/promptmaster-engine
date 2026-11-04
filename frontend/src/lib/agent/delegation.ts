/**
 * The user's own words on what Go may do without asking (4 Nov). Pure.
 *
 * Sean's support-software brief said "Handle routine drafting, arithmetic,
 * checking and corrections without asking me to decide each one. You may ask
 * me to approve the finished document." The setup shortened that to "Handle
 * drafting and arithmetic without asking", and the planner was given only the
 * "Routine decisions" flag. These sentences now reach it as he wrote them,
 * from the project context (his request) and the constraints.
 */

/** A sentence that grants, reserves or limits authority. */
const AUTHORITY =
  /\b(?:without asking|(?:do not|don['’]t|no need to|never) ask(?: me)?|ask me\b|you may\b|you can (?:decide|handle|fix|correct|make)|handle (?:the |all |any )?(?:routine|drafting|corrections?|checking|arithmetic|it|them|this)|decide (?:it |them |each one )?yourself|i(?:['’]ll| will) approve|my approval|approve the|(?:is|are|not) authori[sz]ed|authori[sz]es|delegat)/i;

const MAX = 6;
const MAX_CHARS = 500;

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

export function delegationSentences(project: { context?: string | null; constraints?: string | null }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of [project.context, project.constraints]) {
    for (const raw of (text ?? '').split(/\n+|(?<=[.!?])\s+(?=[A-Z“"(])/)) {
      const sentence = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (sentence.length < 12 || !AUTHORITY.test(sentence)) continue;
      const key = norm(sentence);
      // The constraints often restate the request; keep the user's wording once.
      if ([...seen].some((k) => k.includes(key) || key.includes(k))) continue;
      seen.add(key);
      out.push(sentence.length > MAX_CHARS ? `${sentence.slice(0, MAX_CHARS - 1)}…` : sentence);
      if (out.length >= MAX) return out;
    }
  }
  return out;
}
