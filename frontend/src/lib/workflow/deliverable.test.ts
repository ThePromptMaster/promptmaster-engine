import { describe, expect, it } from 'vitest';

import { deliverableDocument, HOLDS_THE_WORK, ONLY_A_NOTE } from './deliverable';
import { deliverableStage } from './engine';
import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { StageDefinition, WorkflowTemplate } from './types';

/**
 * 5 Nov (a six-chapter book test): the review's corrections went into the finished
 * stage, while the export, the objective check and "Have Go fix it" used the
 * chapters. The download had Sam approving 2:30; Go described 2pm on three conditions.
 */
const stage = (id: string, renderer: StageDefinition['renderer'], required = true) => ({ id, label: id[0].toUpperCase() + id.slice(1), short_label: id, required, renderer, exit_criteria: [], transitions: {} }) as unknown as StageDefinition;
const template = (...stages: StageDefinition[]) => ({ stages }) as unknown as WorkflowTemplate;
const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

const chapters = (text: string) => ({
  artifact: { id: 'a', stage_id: 'manuscript', long_form: { outline: [{ id: 's1', title: 'One', status: 'complete', content: text }] } },
  versions: [] as never[],
});
const prose = (content: string, n = 9) => ({ artifact: null, versions: [{ id: `v${n}`, version_number: n, content }] });
const designed = template(stage('brief', 'prose'), stage('manuscript', 'long_form'), stage('review', 'review'), stage('finished', 'prose'));

describe('which text the project delivers', () => {
  it('a later stage holding the work is the deliverable, in its own saved version', () => {
    const finished = `${words(950, 'corrected')}`;
    const doc = deliverableDocument(designed, { manuscript: chapters(words(1000, 'original')), finished: prose(finished) } as never)!;
    expect(doc.stage.id).toBe('finished');
    expect(doc.version?.id).toBe('v9');
    expect(doc.text).toBe(finished);
    expect(doc.partial).toBeUndefined();
  });

  it(`at exactly ${HOLDS_THE_WORK * 100}% of the chapters' words it holds the work`, () => {
    // The chapters' text counts its heading: "## 1. One" is three words.
    expect(deliverableDocument(designed, { manuscript: chapters(words(997)), finished: prose(words(800)) } as never)!.stage.id).toBe('finished');
  });

  it('a stage holding only a note goes after the chapters, so nothing is lost', () => {
    const doc = deliverableDocument(designed, { manuscript: chapters(words(1000, 'chapter')), finished: prose('A short note on the review.') } as never)!;
    expect(doc.stage.id).toBe('manuscript');
    expect(doc.version).toBeNull();
    expect(doc.text).toContain('chapter chapter');
    expect(doc.text).toMatch(/## Finished\n\nA short note on the review\.$/);
  });

  it(`between ${ONLY_A_NOTE * 100}% and ${HOLDS_THE_WORK * 100}% it may be a partial retype: the chapters stay, once, and the screen says so`, () => {
    const doc = deliverableDocument(designed, { manuscript: chapters(words(1000, 'chapter')), finished: prose(words(500, 'retyped')) } as never)!;
    expect(doc.stage.id).toBe('manuscript');
    expect(doc.text).not.toContain('retyped');
    expect(doc.partial).toEqual({ label: 'Finished', chapters: 'Manuscript' });
  });

  it('before the later stage is written, the chapters are the deliverable', () => {
    const doc = deliverableDocument(designed, { manuscript: chapters('Chapter text.'), finished: { artifact: null, versions: [] } } as never)!;
    expect(doc.stage.id).toBe('manuscript');
    expect(doc.text).toContain('Chapter text.');
  });

  it('an optional stage, or a table, after the chapters never takes the deliverable', () => {
    const t = template(stage('manuscript', 'long_form'), stage('review', 'review'), stage('extra', 'prose', false));
    expect(deliverableDocument(t, { manuscript: chapters(words(100)), review: prose(words(100)), extra: prose(words(100)) } as never)!.stage.id).toBe('manuscript');
  });

  it('the saved version is named only when it is exactly the chapters', () => {
    const edited = { ...chapters('Edited since.'), versions: [{ id: 'v2', version_number: 2, content: '## 1. One\n\nThe older text.' }] };
    expect(deliverableDocument(template(stage('manuscript', 'long_form')), { manuscript: edited } as never)!.version).toBeNull();
    const same = { ...chapters('Same.'), versions: [{ id: 'v3', version_number: 3, content: '## 1. One\n\nSame.' }] };
    expect(deliverableDocument(template(stage('manuscript', 'long_form')), { manuscript: same } as never)!.version?.id).toBe('v3');
  });
});

describe('the system workflows are unchanged', () => {
  it.each([['Book', BOOK_V1], ['Research', RESEARCH_V1]])('%s keeps its chapters as the deliverable, whatever follows them', (_name, t) => {
    const later = Object.fromEntries(t.stages.filter((s) => s.renderer !== 'long_form').map((s) => [s.id, prose(words(5_000))]));
    const drafting = deliverableStage(t)!;
    const doc = deliverableDocument(t, { ...later, [drafting.id]: chapters(words(1_000)) } as never)!;
    expect(doc.stage.id).toBe(drafting.id);
  });

  it('a workflow with no chapters delivers its last required prose stage, as before', () => {
    const doc = deliverableDocument(SINGLE_OUTPUT_V1, { output: prose('The output.') } as never)!;
    expect(doc.stage.id).toBe(deliverableStage(SINGLE_OUTPUT_V1)!.id);
    expect(doc.text).toBe('The output.');
  });
});
