import { describe, expect, it } from 'vitest';

import { factValues, timeRanges, valueMentions } from './fact-values';

describe('spans of the day (18 Nov, East Dock)', () => {
  it('"7 to 11 a.m." is both times', () => {
    expect(factValues('closed from 7 to 11 a.m. Central').times).toEqual(['7:00', '11:00']);
    expect(factValues('closed 7–11 a.m.').times).toEqual(['7:00', '11:00']);
    expect(factValues('from 9 a.m. to noon Central').times).toEqual(['9:00', '12:00']);
    expect(factValues('11 to 1 p.m.').times).toEqual(['11:00', '13:00']);
    expect(timeRanges('closed from 7 to 11 a.m. Central')).toEqual([{ raw: '7 to 11 a.m.', start: '7:00', end: '11:00' }]);
  });
  it('the 7 is a time, not a plain number', () => {
    expect(factValues('closed from 7 to 11 a.m.').numbers).toEqual([]);
  });
  it('a move from one day and time to another is not a span', () => {
    const m = valueMentions('The meeting moves from Monday 9 a.m. to Tuesday 10 a.m.');
    expect(m.filter((x) => x.kind === 'times').map((x) => [x.value, x.range ?? null])).toEqual([['9:00', null], ['10:00', null]]);
  });
  it('a single time is read as before', () => {
    expect(factValues('reopen at 11 a.m.').times).toEqual(['11:00']);
    expect(factValues('Thursday at 12:30').times).toEqual(['12:30']);
  });
});

import { factChangesFromRevision } from './fact-reconcile';
import { leftoverMentions, supersededValues } from './fact-values';
import type { ProjectFact } from '@/types/project';

const V1 = `**Subject: East loading dock closed 7 to 11 a.m. Central, starting Monday, November 30**

Starting Monday, November 30, the east loading dock will be closed from 7 to 11 a.m. Central for maintenance.

During the closure, drivers should use the west dock and check in with the shift supervisor.

The east dock is expected to reopen at 11 a.m.`;
const V2 = `**Subject: East loading dock closed 9 a.m. to noon Central, starting Tuesday, December 1**

Starting Tuesday, December 1, the east loading dock will be closed from 9 a.m. to noon Central for maintenance.

During the closure, drivers should use the west dock and check in with the shift supervisor.

The east dock is expected to reopen at noon.`;
const INSTRUCTION = 'Maintenance has been rescheduled. Replace the previous schedule with Tuesday, December 1, from 9 a.m. to noon Central. Update the saved announcement, including its subject line and expected reopening time. Keep the west-dock and shift-supervisor instructions. Save and check the revised version.';
const fact = (id: string, statement: string) => ({ id, statement, subject: null, kind: 'fact', retired_at: null, supersedes: null, created_at: '2026-11-17T22:37:20Z' }) as unknown as ProjectFact;

describe("the side chat's revision and the facts (18 Nov, East Dock)", () => {
  const changes = factChangesFromRevision({
    facts: [
      fact('73a7890d', 'Starting Monday, November 30, the east loading dock will be closed from 7 to 11 a.m. Central for maintenance'),
      fact('32ea856e', 'The east dock is expected to reopen at 11 a.m.'),
      fact('6def2d03', 'During the closure, drivers should use the west dock and check in with the shift supervisor'),
    ],
    instruction: INSTRUCTION, before: V1, after: V2,
  });
  it('the closure takes the new span whole: 9 a.m. to noon, not 7 to 9 a.m.', () => {
    const closure = changes.find((c) => c.fact.id === '73a7890d');
    expect(closure?.proposed).toBe('Starting Tuesday, December 1, the east loading dock will be closed from 9 a.m. to noon Central for maintenance');
  });
  it('the reopening time is not guessed: it is left for the check that reads the meaning', () => {
    // 9 a.m. and noon tie for it; 9 a.m. was recorded on production.
    expect(changes.find((c) => c.fact.id === '32ea856e')).toBeUndefined();
  });
  it('a fact the revision kept is not offered', () => {
    expect(changes.find((c) => c.fact.id === '6def2d03')).toBeUndefined();
  });
  it('one value the instruction names still wins a tie with the new text (unchanged)', () => {
    const price = factChangesFromRevision({
      facts: [fact('p', 'Tickets cost $40 per person')],
      instruction: 'Change the ticket price to $30.',
      before: 'Tickets cost $40 per person.', after: 'Tickets cost $30 per person, leaving $20 for snacks.',
    });
    expect(price[0]?.proposed).toBe('Tickets cost $30 per person');
  });
});

describe("a repair's history line is history (18 Nov, East Dock)", () => {
  it('"a.m." does not end the sentence that says "earlier"', () => {
    const superseded = [
      ...supersededValues('Starting Monday, November 30, the east loading dock will be closed from 7 to 11 a.m. Central for maintenance', 'Starting Tuesday, December 1, the east loading dock will be closed from 9 a.m. to noon Central for maintenance'),
      ...supersededValues('The east dock is expected to reopen at 11 a.m.', 'The east dock is expected to reopen at noon.'),
    ];
    // Objective v5, the line both repairs were failed on.
    const v5 = 'The draft\'s earlier schedule has been replaced by the rescheduled closure, which starts Tuesday, December 1, from 9 a.m. to noon Central. The earlier schedule was a closure starting Monday, November 30, from 7 to 11 a.m. Central, reopening at 11 a.m. The subject line, hours and reopening time must change to match the new schedule.';
    expect(leftoverMentions(v5, superseded)).toEqual([]);
    // …and a line that still states the old time as current is still caught.
    expect(leftoverMentions('The east dock reopens at 11 a.m. Central.', superseded).length).toBeGreaterThan(0);
  });
});

import { finishedConclusions } from './brief-change';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowState } from './types';
import type { StageArtifactBundle } from './digest';

describe('a finished stage is judged on its newest text (18 Nov, East Dock)', () => {
  const id = SINGLE_OUTPUT_V1.stages[0].id;
  const state = { current_stage_id: id, stages: { [id]: { status: 'complete', completed_at: '2026-11-17T22:47:35Z' } } } as unknown as WorkflowState;
  const bundle = (versionAt: string) => ({
    [id]: {
      artifact: { summary: 'Closed 7 to 11 a.m. Central, starting Monday, November 30.' },
      versions: [{ content: V2, created_at: versionAt }],
    },
  }) as unknown as Record<string, StageArtifactBundle>;

  it('a version saved after it finished is read, not the summary stored when it finished', () => {
    const [c] = finishedConclusions(SINGLE_OUTPUT_V1, state, bundle('2026-11-17T22:50:04Z'), '2026-11-17T22:50:15Z');
    expect(c.summary).toContain('9 a.m. to noon');
    expect(c.summary).not.toContain('November 30');
  });
  it('with no newer version, the stored summary is used (unchanged)', () => {
    const [c] = finishedConclusions(SINGLE_OUTPUT_V1, state, bundle('2026-11-17T22:40:00Z'), '2026-11-17T22:50:15Z');
    expect(c.summary).toContain('November 30');
  });
});
