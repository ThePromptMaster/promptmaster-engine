import { describe, expect, it } from 'vitest';

import { meaningOf, openBriefChange, presentationOnly } from './brief-change';
import { laterDoneStages, projectState } from './engine';
import { BOOK_V1 } from './templates/book.v1';
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
