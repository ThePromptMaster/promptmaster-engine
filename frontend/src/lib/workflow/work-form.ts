/**
 * The form of the work, read from the brief (13 Oct; Sean's screenplay test:
 * "the sidebar says Book, the stage instructions mention chapters").
 *
 * Mirrors `backend/promptmaster/work_form.py`, which tells every prompt; this
 * side changes the words on the page. A keyword map, never a model call.
 */
import type { Project } from '@/types/project';

export interface WorkForm {
  key: 'screenplay' | 'play' | 'novel';
  /** As the sidebar names it. */
  label: string;
  /** What a book's chapter is in it. */
  unit: string;
  fiction: boolean;
}

const FORMS: [RegExp, WorkForm][] = [
  // 25 Oct (Sean): "short film", "pilot" and "episode" briefs were read as a book.
  [/\b(screen\s?play|screen-play|film script|movie script|teleplay|feature[- ]length script|shooting script|(?:tv|television) (?:script|pilot|episode)|pilot (?:script|episode)|episode script|short film|feature film|sitcom)s?\b/i, { key: 'screenplay', label: 'Screenplay', unit: 'sequence', fiction: true }],
  [/\b(stage play|stageplay|play script|theatre script|theater script|one-act play|two-act play|three-act play)s?\b/i, { key: 'play', label: 'Stage play', unit: 'scene', fiction: true }],
  [/(?<![-\w])(novel|novella|short story|short stories|fiction|fictional story)\b/i, { key: 'novel', label: 'Fiction', unit: 'chapter', fiction: true }],
];

export function formOf(project: Pick<Project, 'objective'> & Partial<Pick<Project, 'output_format' | 'constraints'>>): WorkForm | null {
  const text = [project.objective, project.output_format, project.constraints].filter(Boolean).join(' ');
  return FORMS.find(([re]) => re.test(text))?.[1] ?? null;
}

const plural = (w: string) => `${w}s`;
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/**
 * A book workflow's words in the form's: book → screenplay, chapter →
 * sequence, manuscript → script. Case is kept; "a book" becomes "a
 * screenplay", never "a a screenplay".
 */
export function inFormWords(text: string, form: WorkForm | null): string {
  if (!form || !text || form.key === 'novel') return text;
  const swap: [string, string][] = [
    ['books', plural(form.key)],
    ['book', form.key],
    ['chapters', plural(form.unit)],
    ['chapter', form.unit],
    ['manuscripts', 'scripts'],
    ['manuscript', 'script'],
  ];
  let out = text;
  for (const [from, to] of swap) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to).replace(new RegExp(`\\b${cap(from)}\\b`, 'g'), cap(to));
  }
  return out;
}
