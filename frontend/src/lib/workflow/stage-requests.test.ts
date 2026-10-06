import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { parseItems } from './stage-artifact';
import { generationContent, generationRequest } from './stage-requests';
import { initialState } from './engine';
import { RESEARCH_V1 } from './templates/research.v1';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const empty = { content: '', items: [], finish_reason: 'stop', model_used: 'm' } as never;

describe('generationContent', () => {
  it('stores an empty open-items table as a valid draft, not as "came back empty"', () => {
    const content = generationContent(stage('final_review'), empty);
    expect(parseItems(content)).toEqual([]);
  });
  it('still treats an empty findings table as unusable', () => {
    expect(generationContent(stage('critique'), empty)).toBe('');
  });

  it('keeps every row field within its limit, so the table can be saved (5 Oct, production)', () => {
    const literature = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;
    const long = 'Michael E. Fagan (1976). Design and Code Inspections to Reduce Errors in Program Development. IBM Systems Journal 15(3), 182–211. A field study across several large projects at IBM. DOI 10.1147/sj.153.0182 and more words to run past the limit set for this field.';
    const res = { content: '', items: [{ id: 'w1', work: long, finding: 'f', relation: 'r', status: 'candidate' }], finish_reason: 'stop', model_used: 'm' } as never;
    const [row] = parseItems(generationContent(literature, res))!;
    expect(long.length).toBeGreaterThan(240);
    expect(row.work!.length).toBeLessThanOrEqual(240);
    expect(row.work!.endsWith('…')).toBe(true);
    expect(row.finding).toBe('f');
  });
});

describe('the request says who may set which status (1 Oct, items 3, 12, 18)', () => {
  const state = initialState(RESEARCH_V1);
  const project = { objective: 'o', audience: 'a', constraints: '', mode: 'architect', model: 'm' } as never;
  const schemaFor = (stageId: string) =>
    generationRequest(project, RESEARCH_V1, state, {}, RESEARCH_V1.stages.find((s) => s.id === stageId)!, '').item_schema!;

  it('a run may be marked not run by the model, never completed', () => {
    const statuses = Object.fromEntries(schemaFor('experiment').statuses!.map((s) => [s.value, s]));
    expect(statuses.not_run).toMatchObject({ model_may_set: true, requires_reason: true });
    expect(statuses.completed.model_may_set).toBe(false);
    expect(statuses.deviated.model_may_set).toBe(false);
  });
  it('a validation row may be marked not attempted by the model, never reproduced; the meanings go with it (2 Oct, item 12)', () => {
    const statuses = Object.fromEntries(schemaFor('validation').statuses!.map((s) => [s.value, s]));
    expect(statuses.not_attempted).toMatchObject({ model_may_set: true, requires_reason: true });
    expect(statuses.independently_reproduced.model_may_set).toBe(false);
    expect(statuses.supported_by_prior.explain).toBe('It agrees with earlier studies or records. Nothing was recalculated.');
    // The old value is not offered to the model at all.
    expect(statuses.reproduced).toBeUndefined();
  });
  it('judgments the draft can see in its own words are proposed, never set (3 Oct)', () => {
    const proposes = (stageId: string) => schemaFor(stageId).statuses!.filter((s) => s.model_may_propose).map((s) => s.value);
    expect(proposes('alternatives')).toEqual(['ruled_out', 'addressed', 'left_open']);
    expect(proposes('validation')).toEqual(['supported_by_prior', 'consistency_check']);
    expect(proposes('final_review')).toEqual(['accepted', 'deferred']);
    // What says something was carried out stays the user's or a run's.
    expect(proposes('experiment')).toEqual([]);
    expect(schemaFor('validation').statuses!.find((s) => s.value === 'independently_reproduced')!.model_may_propose).toBe(false);
  });
  it('a recalled work starts as a candidate, and the model is never asked for a DOI', () => {
    const schema = schemaFor('literature');
    expect(schema.statuses!.find((s) => s.model_default)?.value).toBe('candidate');
    expect(schema.statuses!.some((s) => s.model_may_set)).toBe(false);
    expect(schema.fields.map((f) => f.key)).toEqual(['work', 'finding', 'relation']);
  });
});
