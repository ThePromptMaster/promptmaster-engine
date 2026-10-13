/** 13 Oct (Sean's screenplay): the form of the work, fiction in the fact-check, and the stage's own mode. */
import { describe, expect, it } from 'vitest';

import { formOf, inFormWords } from './work-form';
import { modeForStage } from './stage-mode';
import { isTriaged, itemSchemaFor } from './stage-artifact';
import { BOOK_V1 } from './templates/book.v1';

const screenplay = { objective: 'I want to write a screenplay about the French revolution', output_format: 'A feature-length screenplay' };

describe('the form of the work', () => {
  it('is read from the brief', () => {
    expect(formOf(screenplay)?.key).toBe('screenplay');
    expect(formOf({ objective: 'A three-act stage play about a lighthouse' })?.key).toBe('play');
    expect(formOf({ objective: 'A novella set in Lisbon' })?.key).toBe('novel');
    expect(formOf({ objective: 'A non-fiction book about tides' })).toBeNull();
    expect(formOf({ objective: 'Using only the fictional evidence below, write a status pack' })).toBeNull();
  });

  it('puts the workflow’s words in the form’s', () => {
    const form = formOf(screenplay);
    expect(inFormWords('State what the book is for. Saying it now saves an argument at chapter nine.', form)).toBe(
      'State what the screenplay is for. Saying it now saves an argument at sequence nine.'
    );
    expect(inFormWords('Chapters and the Manuscript', form)).toBe('Sequences and the Script');
    expect(inFormWords('the book', null)).toBe('the book');
  });
});

describe('a fact-check of fiction', () => {
  const schema = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'fact_check')!);

  it('"Fiction — not an external claim" settles a row with no reason', () => {
    expect(schema.statuses?.some((s) => s.value === 'fiction')).toBe(true);
    expect(isTriaged({ id: 'c1', claim: 'Adrien was born in Arras', status: 'fiction' }, schema)).toBe(true);
  });

  it('"No source found" is a search result, not a decision', () => {
    expect(isTriaged({ id: 'c2', claim: 'The Committee met nightly', status: 'no_source' }, schema)).toBe(false);
    expect(schema.statuses?.find((s) => s.value === 'no_source')?.label).toBe('No source found yet — your decision');
  });
});

describe('the stage’s own mode (12.7)', () => {
  const critique = BOOK_V1.stages.find((s) => s.id === 'critique')!;

  it('Critique is worked as Cold Critic unless the user keeps their own mode', () => {
    expect(modeForStage({ mode: 'architect' }, critique)).toBe('cold_critic');
    expect(modeForStage({ mode: 'architect', stage_modes: 'project' }, critique)).toBe('architect');
    expect(modeForStage({ mode: 'custom' }, critique)).toBe('custom');
    expect(modeForStage({ mode: 'architect' }, { recommended_modes: [] })).toBe('architect');
  });
});
