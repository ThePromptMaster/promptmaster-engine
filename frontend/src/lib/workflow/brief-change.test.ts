import { describe, expect, it } from 'vitest';

import { answeredOnStages, leftToGo, meaningOf, openBriefChange, presentationOnly, settledChange, onlyFromTheChat, proposedChange } from './brief-change';
import { factsText } from './facts';
import type { ProjectFact } from '@/types/project';
import { laterDoneStages, projectState } from './engine';
import { BOOK_V1 } from './templates/book.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowEvent } from './types';

const ev = (type: WorkflowEvent['type'], stage_id: string, created_at: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type, stage_id, actor: 'user', created_at, ...extra,
});
const done = [
  ev('stage_marked_complete', 'objective', '2026-10-06T10:00:00Z', { to_stage_id: 'audience', payload: { evidence_version_id: 'v1' } }),
  ev('stage_marked_complete', 'audience', '2026-10-06T10:01:00Z', { to_stage_id: 'positioning', payload: { evidence_version_id: 'v2' } }),
];

describe('a change to the brief (Sean, 5 Oct)', () => {
  it('punctuation, case, spacing and formatting are not a change of meaning', () => {
    expect(presentationOnly('Funding is secured through Q3 2026', '**Funding** is secured through Q3, 2026.')).toBe(true);
    expect(presentationOnly('Funding is secured.', 'Funding is pending.')).toBe(false);
    expect(presentationOnly('same', 'same')).toBe(false);
    expect(meaningOf('Margin — "short-term"!')).toBe('margin short term');
  });

  it('reopens only the stages it names, with why, and leaves the rest finished', () => {
    const state = projectState(BOOK_V1, [
      ...done,
      ev('brief_changed', 'positioning', '2026-10-06T11:00:00Z', {
        payload: { field: 'context', kind: 'fact', affected: [{ stage_id: 'audience', reason: "It relied on 'funding secured'." }, { stage_id: 'research', reason: 'not done' }] },
      }),
    ]);
    expect(state.stages.audience).toMatchObject({ status: 'stale', stale: { reason: "It relied on 'funding secured'.", was: 'completed_with_artifact' } });
    expect(state.stages.objective.status).toBe('completed_with_artifact');
    expect(state.stages.research?.status ?? 'not_started').toBe('not_started');
    expect(state.current_stage_id).toBe('positioning');
  });

  it('"keep them as they are" puts them back; finishing the stage again clears it too', () => {
    const changed = ev('brief_changed', 'positioning', '2026-10-06T11:00:00Z', { payload: { affected: [{ stage_id: 'audience', reason: 'r' }] } });
    const kept = projectState(BOOK_V1, [...done, changed, ev('brief_change_dismissed', 'positioning', '2026-10-06T11:05:00Z', { payload: { change_at: changed.created_at } })]);
    expect(kept.stages.audience.status).toBe('completed_with_artifact');
    expect(kept.stages.audience.stale).toBeUndefined();

    const open = projectState(BOOK_V1, [...done, changed]);
    expect(openBriefChange([...done, changed], open)).toMatchObject({ stageIds: ['audience'] });
    expect(openBriefChange([...done, changed], kept)).toBeNull();
  });

  it('a wording-only change reopens nothing', () => {
    const state = projectState(BOOK_V1, [...done, ev('brief_changed', 'positioning', '2026-10-06T11:00:00Z', { payload: { kind: 'wording', presentation_only: true, affected: [] } })]);
    expect(Object.values(state.stages).some((s) => s.status === 'stale')).toBe(false);
  });
});

describe('a saved revision of an earlier stage (H1b; Sean, 7 Oct, workshop)', () => {
  const finished = [
    ...done,
    ev('stage_marked_complete', 'positioning', '2026-10-06T10:02:00Z', { to_stage_id: 'research', payload: { evidence_version_id: 'v3' } }),
  ];
  const saved = ev('stage_version_saved', 'audience', '2026-10-07T09:00:00Z', {
    payload: { version_id: 'v2b', version_number: 2, prior_version_id: 'v2' },
  });

  it('reopens the done stages after it, naming the change, and nothing before it', () => {
    const state = projectState(BOOK_V1, [...finished, ev('stage_reopened', 'audience', '2026-10-07T08:59:00Z'), saved]);
    expect(state.stages.positioning).toMatchObject({
      status: 'stale',
      stale: { reason: 'Audience was changed (now v2) after this stage used it.', since: saved.created_at, was: 'completed_with_artifact' },
    });
    expect(state.stages.objective.status).toBe('completed_with_artifact');
    expect(state.stages.audience.status).toBe('in_progress');
    expect(state.stages.research.status).toBe('in_progress');
  });

  it('is what the recheck notice reports, and "keep them as they are" puts them back', () => {
    const state = projectState(BOOK_V1, [...finished, saved]);
    expect(openBriefChange([...finished, saved], state)).toEqual({ event: saved, stageIds: ['positioning'] });
    const kept = projectState(BOOK_V1, [...finished, saved, ev('brief_change_dismissed', 'research', '2026-10-07T09:05:00Z', { payload: { change_at: saved.created_at } })]);
    expect(kept.stages.positioning.status).toBe('completed_with_artifact');
  });

  it('laterDoneStages names only done work after the stage', () => {
    const state = projectState(BOOK_V1, finished);
    expect(laterDoneStages(BOOK_V1, state, 'audience')).toEqual(['positioning']);
    expect(laterDoneStages(BOOK_V1, state, 'positioning')).toEqual([]);
  });
});

describe('the notice survives a later change that reopened nothing new (8 Oct, production)', () => {
  it('shows the earlier change whose stages still wait', () => {
    const first = ev('brief_changed', 'positioning', '2026-10-08T10:00:00Z', { payload: { affected: [{ stage_id: 'audience', reason: 'price changed' }] } });
    const second = ev('brief_changed', 'positioning', '2026-10-08T10:01:00Z', { payload: { affected: [{ stage_id: 'audience', reason: 'again' }] } });
    const state = projectState(BOOK_V1, [...done, first]);
    // `second` names a stage that is already stale: nothing new reopened.
    expect(openBriefChange([...done, first, second], state)?.event).toBe(first);
  });
});

describe('a draft in progress is rechecked too (8 Oct, production)', () => {
  it('a save names the later draft in progress, and it is reopened', () => {
    const state0 = projectState(BOOK_V1, done);
    expect(laterDoneStages(BOOK_V1, state0, 'objective', new Set(['positioning']))).toEqual(['audience', 'positioning']);
    const saved = ev('stage_version_saved', 'objective', '2026-10-08T12:00:00Z', { payload: { version_number: 2, affected: ['audience', 'positioning'] } });
    const state = projectState(BOOK_V1, [...done, saved]);
    expect(state.stages.positioning).toMatchObject({ status: 'stale', stale: { was: 'in_progress' } });
    expect(state.stages.audience.status).toBe('stale');
  });

  it('a fact change reopens a named draft in progress', () => {
    const changed = ev('brief_changed', 'positioning', '2026-10-08T12:00:00Z', { payload: { affected: [{ stage_id: 'positioning', reason: 'It states $18' }] } });
    expect(projectState(BOOK_V1, [...done, changed]).stages.positioning.status).toBe('stale');
  });
});

describe('every reopened stage has the notice and its button (Sean, 14 Oct: "the go button for revisions doesn\'t show up sometimes")', () => {
  const three = [
    ...done,
    ev('stage_marked_complete', 'positioning', '2026-10-06T10:02:00Z', { to_stage_id: 'research', payload: { evidence_version_id: 'v3' } }),
  ];

  it('a return to an earlier stage', () => {
    const back = ev('stage_returned', 'research', '2026-10-14T09:00:00Z', { to_stage_id: 'audience' });
    const state = projectState(BOOK_V1, [...three, back]);
    const open = openBriefChange([...three, back], state);
    expect(open?.event).toBe(back);
    expect(open?.stageIds).toEqual(['positioning']);
    expect(open?.reasons?.positioning).toBe('The work went back to Audience after this stage used it.');
  });

  it('an earlier stage completed again on another version', () => {
    const again = ev('stage_marked_complete', 'audience', '2026-10-14T09:00:00Z', { payload: { evidence_version_id: 'v2c' } });
    const events = [...three, ev('stage_reopened', 'audience', '2026-10-14T08:59:00Z'), again];
    const state = projectState(BOOK_V1, events);
    expect(state.stages.positioning.status).toBe('stale');
    expect(openBriefChange(events, state)).toMatchObject({ event: again, stageIds: ['positioning'] });
  });

  it('names stages still waiting from an earlier change beside the latest', () => {
    const fact = ev('brief_changed', 'research', '2026-10-14T09:00:00Z', { payload: { field: 'facts', affected: [{ stage_id: 'objective', reason: 'a' }] } });
    const back = ev('stage_returned', 'research', '2026-10-14T08:00:00Z', { to_stage_id: 'audience' });
    const events = [...three, back, fact];
    const open = openBriefChange(events, projectState(BOOK_V1, events));
    expect(open).toMatchObject({ event: fact, stageIds: ['objective'], alsoWaiting: ['positioning'] });
  });
});

describe('"Updated and checked", the last step (Sean, 14 Oct, SUMMIT)', () => {
  const fact = ev('brief_changed', 'positioning', '2026-10-14T09:00:00Z', { payload: { field: 'facts', affected: [{ stage_id: 'audience', reason: 'spend changed' }] } });
  const now = Date.parse('2026-10-14T10:00:00Z');

  it('is reached once every stage the change reopened is finished again after it', () => {
    const waiting = [...done, fact];
    expect(settledChange(waiting, projectState(BOOK_V1, waiting), now)).toBeNull();
    const repaired = [...waiting, ev('stage_marked_complete', 'audience', '2026-10-14T09:05:00Z', { actor: 'system', payload: { evidence_version_id: 'v2r' } })];
    expect(settledChange(repaired, projectState(BOOK_V1, repaired), now)).toMatchObject({ event: fact, stageIds: ['audience'] });
    expect(settledChange(repaired, projectState(BOOK_V1, repaired), now + 13 * 3600_000)).toBeNull();
  });

  it('is not reached when the user kept the work as it was', () => {
    const kept = [...done, fact, ev('brief_change_dismissed', 'positioning', '2026-10-14T09:01:00Z', { payload: { change_at: fact.created_at } })];
    expect(settledChange(kept, projectState(BOOK_V1, kept), now)).toBeNull();
  });
});

describe('an answer given to Go is left to Go on the stage it was asked from (4 Nov)', () => {
  const fact = (id: string, statement: string, source_ref: Record<string, unknown>, extra: Partial<ProjectFact> = {}): ProjectFact => ({
    id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'user_edit', source_ref,
    accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-11-04T14:02:34Z', ...extra,
  });
  const brief = fact('f1', 'The participant count is 24, replacing 18.', {}, { kind: 'requirement' });
  // The production fact, as answerAsFact recorded it.
  const answer = fact('f2', 'Decided by the user — asked "Do you approve this current version as the finished proposal?", answered: Make it shorter to leave room under 650 words', {
    via: 'go answer', run_id: 'r1', step_id: 's7', stage_id: 'final_proposal',
  });

  it('names the stage of an answer that is all the change added', () => {
    expect([...answeredOnStages(factsText([brief]), [brief, answer])!]).toEqual(['final_proposal']);
  });

  it('judges everywhere when the user added a fact of their own too, or nothing was added', () => {
    const own = fact('f3', 'The budget is $1,500.', { via: 'facts panel' });
    expect(answeredOnStages(factsText([brief]), [brief, answer, own])).toBeNull();
    expect(answeredOnStages(factsText([brief]), [brief, own])).toBeNull();
    expect(answeredOnStages(factsText([brief, answer]), [brief, answer])).toBeNull();
    // Retiring a fact is not an answer either.
    expect(answeredOnStages(factsText([brief, answer]), [{ ...brief, retired_at: '2026-11-04T15:00:00Z' }, answer])).toBeNull();
  });

  it('the judged stages keep everything but the stage the answer was given on', () => {
    // The production judgments: "Make it shorter…" (14:02) named Final proposal
    // alone; "make Section 7 a single sentence", judged with Final proposal
    // hidden (#483), named the stages before it (16:36).
    const shorter = [{ stage_id: 'final_proposal', reason: 'The user asked for it to be shortened.' }];
    expect(leftToGo(shorter, new Set(['final_proposal']))).toEqual({ affected: [], left: ['final_proposal'] });
    const figures = [{ stage_id: 'option_pricing', reason: 'Priced for 18.' }, { stage_id: 'final_proposal', reason: 'Built on 18.' }];
    expect(leftToGo(figures, new Set(['final_proposal']))).toEqual({ affected: [figures[0]], left: ['final_proposal'] });
    expect(leftToGo(figures, null)).toEqual({ affected: figures, left: [] });
  });

  it('an answer recorded without its stage is judged everywhere', () => {
    const loose = fact('f4', 'Decided by the user — answered: yes', { via: 'go answer', run_id: 'r1' });
    expect(answeredOnStages(factsText([brief]), [brief, loose])).toBeNull();
  });
});

describe('a fact recorded from a side-chat reply is offered, not applied (5 Nov, a rollout pack)', () => {
  const fact = (statement: string, source_kind: string, via?: string) => ({ statement, kind: 'fact', source_kind, source_ref: via ? { via } : {}, retired_at: null, created_at: '2026-11-05T21:58:19Z' }) as never;

  it('when every fact added came from the chat', () => {
    const before = '';
    expect(onlyFromTheChat(before, [fact('An agent says it moved the date.', 'chat', 'side chat')])).toBe(true);
  });

  it('not one typed into the facts panel or given with "Change it", which reopen at once', () => {
    expect(onlyFromTheChat('', [fact('The budget is $12,000.', 'user_edit')])).toBe(false);
    expect(onlyFromTheChat('', [fact('From chat.', 'chat', 'side chat'), fact('By hand.', 'user_edit')])).toBe(false);
  });

  it('not what the start conversation brought in', () => {
    expect(onlyFromTheChat('', [fact('From the start.', 'chat', 'front door')])).toBe(false);
  });

  it('not when nothing was added', () => {
    expect(onlyFromTheChat('', [])).toBe(false);
  });

  const offered = { type: 'brief_changed', stage_id: 'pack', created_at: '2026-11-05T21:58:29Z', payload: { affected: [], proposed: [{ stage_id: 'pack', reason: 'It says the drafts are unsent.' }] } } as never;

  it('stays offered until the user decides', () => {
    expect(proposedChange([offered])).toEqual({ at: '2026-11-05T21:58:29Z', stageId: 'pack', affected: [{ stage_id: 'pack', reason: 'It says the drafts are unsent.' }] });
  });

  it('is gone once taken up, or kept on record', () => {
    expect(proposedChange([offered, { type: 'brief_changed', stage_id: 'pack', created_at: '2026-11-05T21:59:00Z', payload: { takes_up: '2026-11-05T21:58:29Z', affected: [] } } as never])).toBeNull();
    expect(proposedChange([offered, { type: 'brief_change_dismissed', stage_id: 'pack', created_at: '2026-11-05T21:59:00Z', payload: { change_at: '2026-11-05T21:58:29Z' } } as never])).toBeNull();
  });

  it('reopens nothing while it is offered', () => {
    const state = projectState(SINGLE_OUTPUT_V1, [
      { type: 'stage_marked_complete', stage_id: 'input', created_at: '2026-11-05T21:00:00Z' } as never,
      { ...(offered as object), stage_id: 'input', payload: { affected: [], proposed: [{ stage_id: 'input', reason: 'x' }] } } as never,
    ]);
    expect(state.stages.input?.status).not.toBe('stale');
  });
});
