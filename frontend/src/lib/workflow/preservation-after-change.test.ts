import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { askedOfStage, asksForRemovals, briefChangedSince, correctedValues, keepUnasked, restoreLines } from './preservation';
import { statesValue } from './fact-values';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

// 27 Nov (Sean, Redwood Member Center; L-327): "After Output v1 saved an
// internal operations memo, I changed the objective, audience, constraints, and
// format to a customer-facing FAQ … The revision record says Go kept lines the
// rewrite had dropped, including the memo header, Pavel's staffing tasks, and
// the $1,200 contingency." His saved texts: Output v1, and v2 with the lines
// the guard put back taken out again (what the model wrote).
describe('a revision after the work itself changed is a rewrite (L-327)', () => {
  const memo = fixture('redwood-output-v1.md');
  const faq = fixture('redwood-output-v2-model.md');
  const outputV1At = '2026-11-27T16:02:55.000Z';
  const change = (field: string, after: string, at: string, kind = 'intent') => ({ type: 'brief_changed', created_at: at, payload: { field, kind, presentation_only: false, affected: [{ stage_id: 'review' }], before: '', after } });
  const events = [
    { type: 'stage_marked_complete', created_at: '2026-11-27T16:02:37.000Z', payload: {} },
    change('objective', 'Replace the internal operations memo as this project’s current deliverable with a customer-facing FAQ draft about the approved west entrance closure.', '2026-11-27T16:03:27.000Z'),
    change('audience', 'Members and visitors of Redwood Member Center', '2026-11-27T16:03:30.000Z'),
    change('constraints', 'Use the supplied approved access facts. Omit internal staffing, Pavel, the $1,200 contingency, decision IDs, and the unverified rumor from the customer text.', '2026-11-27T16:03:34.000Z'),
    change('output_format', 'Customer-facing FAQ in plain question-and-answer format, with a draft awaiting release approval label.', '2026-11-27T16:03:36.000Z'),
  ];
  const why = 'Review the plan was changed (now v3) after this stage used it.';

  it('on its own reason alone, the guard put the memo back (the bug)', () => {
    const kept = keepUnasked(memo, faq, why);
    expect(kept.restored).toEqual(expect.arrayContaining(['**MEMO**', '**To:** Lena, Pavel']));
    expect(kept.text).toMatch(/\$1,200 staffing contingency/);
  });

  it('with the brief changed since, nothing of the memo comes back', () => {
    const asked = askedOfStage(why, [], outputV1At, events);
    expect(asked.rewrite).toBe(true);
    expect(asked.asked).toContain('Omit internal staffing, Pavel, the $1,200 contingency');
    const kept = keepUnasked(memo, faq, asked.asked, () => true, asked.rewrite);
    expect(kept).toEqual({ text: faq, restored: [], reported: [] });
    expect(kept.text).not.toMatch(/MEMO|Pavel|\$1,200|Classification/);
  });

  it('a constraints change alone is asked of the work, not a rewrite; its "omit" still lets the lines go', () => {
    const only = briefChangedSince([events[3]], outputV1At);
    expect(only).toEqual({ asked: [expect.stringContaining('Omit internal staffing')], rewrite: false });
    const asked = askedOfStage(why, [], outputV1At, [events[3]]);
    expect(keepUnasked(memo, faq, asked.asked).restored).toEqual([]);
  });

  it('a change before the version, a wording edit, a folder rule or a linked project is not counted', () => {
    expect(briefChangedSince(events, '2026-11-27T16:04:00.000Z')).toEqual({ asked: [], rewrite: false });
    const wording = { ...events[1], payload: { ...events[1].payload, presentation_only: true } };
    const folder = { ...events[1], payload: { ...events[1].payload, origin: 'folder' } };
    const reference = { ...events[1], payload: { ...events[1].payload, field: 'context', origin: 'reference' } };
    const madeBefore = { ...events[1], payload: { ...events[1].payload, kind: 'fact', made_before_change: true } };
    expect(briefChangedSince([wording, folder, reference, madeBefore], outputV1At)).toEqual({ asked: [], rewrite: false });
    expect(briefChangedSince([change('objective', 'Same memo, tighter', '2026-11-27T16:03:27.000Z', 'fact')], outputV1At).rewrite).toBe(false);
  });
});

// 27 Nov (Sean, Alder Quay; L-327): "the revision record said it restored the
// obsolete line 'Slots: 5 of 5 used, none spare,' and I confirmed that line was
// in Objective v3." The approval check said the version "still use[s] five
// slots … instead of three slots".
describe('what a check says the text still uses is the old value (L-327)', () => {
  const v2 = fixture('alder-objective-v2.md');
  const v3 = fixture('alder-objective-v3-model.md');
  const instruction = fixture('alder-objective-v3-instruction.txt');

  it('"still use five slots … instead of three slots": five is old, three is not', () => {
    const wrong = correctedValues(instruction);
    expect(wrong.some((v) => v.kind === 'numbers' && v.value === '5')).toBe(true);
    expect(wrong.some((v) => v.value === '3')).toBe(false);
    expect(wrong.some((v) => v.kind === 'weekdays' && v.value === 'thursday')).toBe(true);
    expect(statesValue('- Slots: 5 of 5 used, none spare.', 'numbers', '5')).toBe(true);
  });

  it('the obsolete slots line is not put back into his v3', () => {
    const kept = keepUnasked(v2, v3, instruction);
    expect(kept.restored).not.toContain('- Slots: 5 of 5 used, none spare.');
    expect(kept.text).not.toMatch(/Slots: 5 of 5 used, none spare/);
  });

  it('the general rule still reads "not X" and "instead of X" as X wrong', () => {
    expect(correctedValues('The total is 36, not 48.').map((v) => v.value)).toEqual(['48']);
    expect(correctedValues('Use 18 seats instead of 24.').map((v) => v.value)).toEqual(['24']);
  });
});

describe('a line put back goes after its own neighbour, not the first copy of it (L-327)', () => {
  it('between two formulas, after the second', () => {
    const before = ['Intro.', '$$', 'a = 1', '$$', 'Middle.', '$$', 'b = 2', '$$', 'Slots: 4 of 5 used.', 'End.'].join('\n');
    const after = ['Intro.', '$$', 'a = 1', '$$', 'Middle.', '$$', 'b = 3', '$$', 'End.'].join('\n');
    expect(restoreLines(before, after, ['Slots: 4 of 5 used.'])).toBe(['Intro.', '$$', 'a = 1', '$$', 'Middle.', '$$', 'b = 3', '$$', 'Slots: 4 of 5 used.', 'End.'].join('\n'));
  });
});

// 28 Nov hand pass (L-332): Go was asked to "Replace the Alder Quay rollout
// text with the Birch Lane book swap notice", and the guard put three Alder
// lines back into the new notice.
describe('replacing the text is a rewrite (L-332)', () => {
  it.each([
    'Replace the Alder Quay rollout text with the Birch Lane book swap notice: one page, with Summary (max 40 words), Details and Open questions.',
    'Replace the entire current text with the Birch Lane book swap notice.',
    'Do not keep any Alder Quay material.',
    'Replace this section by the new FAQ.',
  ])('%s', (instruction) => {
    expect(asksForRemovals(instruction)).toBe(true);
  });

  it('a change that only replaces a value is not a rewrite', () => {
    expect(asksForRemovals('Change the date to Sunday.')).toBe(false);
    expect(asksForRemovals('Replace the $40 ticket price with $30.')).toBe(false);
    expect(asksForRemovals('Keep everything else exactly as it is.')).toBe(false);
  });
});

