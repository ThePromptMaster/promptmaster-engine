import { describe, expect, it } from 'vitest';

import { replacementOf, rewordedOnly, sentenceUsingFact, sourceIds, stagesUsingFacts, statementsOf } from './fact-dependencies';
import type { ProjectFact } from '@/types/project';

describe('which finished work used a fact (L-52)', () => {
  const memo = 'Candidate A is recommended. Candidate B has managed 100 or more employees for 4 years, against 7 for A. Both interviewed well.';

  it('finds the sentence that states the fact\'s figures', () => {
    expect(sentenceUsingFact(memo, 'Candidate B has managed 100 or more employees for 4 years')).toBe(
      'Candidate B has managed 100 or more employees for 4 years, against 7 for A.'
    );
    // A figure alone, without any of the fact's words, is not a use.
    expect(sentenceUsingFact('Section 4 years ago', 'Candidate B has managed 100 or more employees for 4 years')).toBeNull();
    // 14 is not 4.
    expect(sentenceUsingFact('Candidate B led 100 or more employees for 14 years.', 'Candidate B has managed 100 or more employees for 4 years')).toBeNull();
  });

  it('a fact without figures is used when most of its words are', () => {
    expect(sentenceUsingFact('The Leeds plant closes before spring.', 'The Leeds plant closes')).toBe('The Leeds plant closes before spring.');
    expect(sentenceUsingFact('Leeds is a city.', 'The Leeds plant closes')).toBeNull();
  });

  it('reopens only the stages that used the old value, each with the sentence', () => {
    const affected = stagesUsingFacts(['Candidate B has managed 100 or more employees for 4 years'], [
      { stage_id: 'analysis', label: 'Analysis', text: memo },
      { stage_id: 'brief', label: 'Brief', text: 'Choose a COO for the board.' },
    ]);
    expect(affected).toEqual([{ stage_id: 'analysis', reason: expect.stringContaining('"Candidate B has managed 100 or more employees for 4 years, against 7 for A."') }]);
  });

  it('reads the statements back out of the facts text', () => {
    expect(statementsOf('- A has 7 years\n- Requirement: Keep one researcher free')).toEqual(['A has 7 years', 'Keep one researcher free']);
  });

  it('finds a date or a price however the stage wrote it, without the year (8 Oct, TeamNotes)', () => {
    expect(sentenceUsingFact('TeamNotes launches on Nov. 12th for every team.', 'Launch date: November 12, 2026')).toBe('TeamNotes launches on Nov. 12th for every team.');
    expect(sentenceUsingFact('It costs $12.00 per seat each month.', 'Price: $12 per user per month')).toBe('It costs $12.00 per seat each month.');
    expect(sentenceUsingFact('It launches on November 19.', 'Launch date: November 12, 2026')).toBeNull();
  });
});

describe('a fact only reworded, every value the same (27 Nov, production pass of change 4)', () => {
  const was = "Harbor Crew Hire charges $410 per person per day and moves a booking free with 7 days' notice.";

  it('same amounts and numbers in other words is only reworded', () => {
    expect(rewordedOnly(was, "Harbor Crew Hire's rate is $410 per person per day, and a booking can be moved at no charge with 7 days' notice.")).toBe(true);
  });

  it('a value that moved, went or came is a change', () => {
    expect(rewordedOnly(was, "Harbor Crew Hire charges $420 per person per day and moves a booking free with 7 days' notice.")).toBe(false);
    expect(rewordedOnly(was, "Harbor Crew Hire charges $410 per person per day and moves a booking free with 10 days' notice.")).toBe(false);
    expect(rewordedOnly(was, 'Harbor Crew Hire charges $410 per person per day.')).toBe(false);
    expect(rewordedOnly(was, undefined)).toBe(false);
  });

  it('a fact with no values is never only reworded', () => {
    expect(rewordedOnly('The room is in the existing warehouse.', 'The new room sits inside the current warehouse.')).toBe(false);
  });

  it('the replacement is found by supersedes, with its subject', () => {
    const f = (over: Partial<ProjectFact>) => ({ id: 'x', statement: '', subject: null, retired_at: null, supersedes: null, ...over }) as unknown as ProjectFact;
    const facts = [
      f({ id: 'a', statement: 'Rate is $410 a day.', subject: 'Crew', retired_at: '2026-11-27T09:35:00Z' }),
      f({ id: 'b', statement: 'The day rate is $410.', subject: 'Crew', supersedes: 'a' }),
    ];
    expect(replacementOf('Crew: Rate is $410 a day.', facts)).toBe('Crew: The day rate is $410.');
    expect(replacementOf('Rate is $410 a day.', facts)).toBeUndefined();
  });
});

describe('a stage that cites a changed fact\'s source relied on it (L-316)', () => {
  // Sean, payroll cutover, 27 Nov: the second update changed the OPS-02 and BANK-04 lines.
  // The Source log paraphrases each source beside its id, so no figure-and-word match found it,
  // and it went on without the two newest sources while it said Complete.
  const log = [
    '| 20 | BANK-04 | The bank | North N7; West W4 | G2 | The bank retracts the North portion of BANK-03. | Same-source correction | Current |',
    '| 21 | OPS-02 | Operations | All three divisions | South done on the new system; North and West not yet run. | Current |',
  ].join('\n');
  const caption = 'Photo: the bridge deck under construction, October 2026 (PHOTO-01). Credit: City of Milwaukee.';

  it('reads a source id whole, never a file name', () => {
    expect(sourceIds('South S4 ran (OPS-02); see BANK-04, CAL-01 and FIRM-01. N8, B2, i5.')).toEqual(['OPS-02', 'BANK-04', 'CAL-01', 'FIRM-01']);
    expect(sourceIds('A KES-T3 code and Q3-2026 are not ids; a REC-03a suffix is.')).toEqual(['REC-03a']);
  });

  it('reopens the log that cites OPS-02 and leaves the caption that cites only PHOTO-01', () => {
    const removed = ['South S4 ran successfully on the new system at 3:10 p.m.; North and West have not run (OPS-02).'];
    expect(sentenceUsingFact(log, removed[0])).toContain('OPS-02');
    const out = stagesUsingFacts(removed, [
      { stage_id: 'source_log', label: 'Source log', text: log },
      { stage_id: 'caption', label: 'Caption', text: caption },
    ]);
    expect(out.map((o) => o.stage_id)).toEqual(['source_log']);
  });

  it('still prefers the sentence that states the old figures', () => {
    const text = 'Entry 21 cites OPS-02.\nSouth S4 ran on the new system at 3:10, and North and West have not run (OPS-02).';
    expect(sentenceUsingFact(text, 'South S4 ran successfully on the new system at 3:10; North and West have not run (OPS-02).')).toBe('South S4 ran on the new system at 3:10, and North and West have not run (OPS-02).');
  });
});
