import type { Locale } from './locales';
import { translate } from './translate';
import { stageText, templateWord } from './templates';
import type { StageDefinition } from '@/lib/workflow/types';

/**
 * The engine's own lines in the interface's language, as they are shown: a
 * criterion's "3 of 5", a measured requirement ("Memo: at most 400 words"),
 * why a stage needs rechecking. The engine writes them in English because Go
 * stores and re-reads them (`needs.ts`, `perform.ts`); this reads that English
 * back by its shape. Anything it does not recognise is a system workflow's own
 * words (`templateWord`) or comes back as written.
 */
type Stages = readonly Pick<StageDefinition, 'id' | 'label' | 'short_label' | 'entry_guidance'>[];

const FIXED: Record<string, string> = {
  'tick when the draft covers it': 'chk.tickDraft',
  'tick once the findings are applied': 'chk.tickApplied',
  'no sections yet': 'chk.noSections',
  'nothing drafted yet': 'chk.nothingDrafted',
  'nothing to check yet': 'chk.nothingToCheck',
};

function range(locale: Locale, text: string): string {
  let m = /^exactly (\d+)$/.exec(text);
  if (m) return translate(locale, 'chk.exactly', { n: m[1] });
  m = /^at most (\d+)$/.exec(text);
  if (m) return translate(locale, 'chk.atMost', { n: m[1] });
  m = /^at least (\d+)$/.exec(text);
  if (m) return translate(locale, 'chk.atLeast', { n: m[1] });
  return text;
}

const subject = (locale: Locale, name: string) => (name === 'The deliverable' ? translate(locale, 'chk.deliverable') : name);

/** One part of a detail line ("12 questions", "3 without an answer"). */
function part(locale: Locale, text: string): string {
  let m = /^(\d+) words$/.exec(text);
  if (m) return translate(locale, 'chk.nWords', { n: m[1] });
  m = /^(\d+) sections?$/.exec(text);
  if (m) return translate(locale, 'chk.nSections', { count: Number(m[1]) });
  m = /^(\d+) questions?$/.exec(text);
  if (m) return translate(locale, 'chk.nQuestions', { count: Number(m[1]) });
  m = /^(\d+) without an answer$/.exec(text);
  if (m) return translate(locale, 'chk.unanswered', { n: m[1] });
  return text;
}

export function shownCheckText(locale: Locale, text: string, templateKey?: string | null, stages?: Stages): string;
export function shownCheckText(locale: Locale, text: string | undefined, templateKey?: string | null, stages?: Stages): string | undefined;
export function shownCheckText(locale: Locale, text: string | undefined, templateKey?: string | null, stages: Stages = []): string | undefined {
  if (!text || locale === 'en') return text;
  const fixed = FIXED[text];
  if (fixed) return translate(locale, fixed);
  const stage = (label: string) => {
    const s = stages.find((x) => x.label === label);
    return s ? stageText(locale, templateKey, s, 'label') : label;
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) of (\d+)$/.exec(text))) return translate(locale, 'chk.nOfM', { n: m[1], m: m[2] });
  if ((m = /^(\d+) of (\d+) incomplete$/.exec(text))) return translate(locale, 'chk.nOfMIncomplete', { n: m[1], m: m[2] });
  if ((m = /^(\d+) still unresolved — each needs a decision$/.exec(text))) return translate(locale, 'chk.unresolved', { n: m[1] });
  if ((m = /^(\d+) untriaged$/.exec(text))) return translate(locale, 'chk.untriaged', { n: m[1] });
  if ((m = /^Manual check: (.+)$/.exec(text))) return translate(locale, 'chk.manual', { rule: m[1] });
  if ((m = /^(.+): (.+) questions, each answered$/.exec(text))) return translate(locale, 'chk.questionsAnswered', { name: subject(locale, m[1]), range: range(locale, m[2]) });
  if ((m = /^(.+): (.+) (words|sections|questions)$/.exec(text))) {
    return translate(locale, `chk.${m[3]}`, { name: subject(locale, m[1]), range: range(locale, m[2]) });
  }
  if ((m = /^(.+): (.+) (pages?) \(estimated\)$/.exec(text))) {
    return translate(locale, m[3] === 'page' ? 'chk.page' : 'chk.pages', { name: subject(locale, m[1]), range: range(locale, m[2]) });
  }
  if ((m = /^about ([\d.]+) (pages?) \((\d+) words; estimated at (\d+) words a page\)$/.exec(text))) {
    return translate(locale, m[2] === 'page' ? 'chk.aboutPage' : 'chk.aboutPages', { pages: m[1], n: m[3], per: m[4] });
  }
  if ((m = /^(.+) was changed \(now v(\d+)\) after this stage used it\.$/.exec(text))) return translate(locale, 'chk.staleChangedV', { stage: stage(m[1]), v: m[2] });
  if ((m = /^(.+) was changed after this stage used it\.$/.exec(text))) return translate(locale, 'chk.staleChanged', { stage: stage(m[1]) });
  if ((m = /^(.+) was completed again on a different version after this stage used it\.$/.exec(text))) return translate(locale, 'chk.staleAgain', { stage: stage(m[1]) });
  if ((m = /^The work went back to (.+) after this stage used it\.$/.exec(text))) return translate(locale, 'chk.staleBack', { stage: stage(m[1]) });
  if (text.includes('; ')) {
    const parts = text.split('; ');
    const shown = parts.map((p) => part(locale, p));
    if (shown.some((s, i) => s !== parts[i])) return shown.join('; ');
  }
  const single = part(locale, text);
  if (single !== text) return single;
  return templateWord(locale, text);
}
