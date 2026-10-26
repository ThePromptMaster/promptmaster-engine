/**
 * 13 Oct (Sean, screenplay and PINE status pack): the repair/recheck loop.
 * Revision's snapshot of the manuscript reopened Continuity, whose recheck
 * reopened Revision; stale records with no time were never counted as
 * repaired; a reopened draft stayed reopened through a good revision.
 */
import { describe, expect, it } from 'vitest';

import { laterDoneStages, laterOf, projectState } from './engine';
import { restoreDecided, decidedBy, checkCommit } from './commit-check';
import { BOOK_V1 } from './templates/book.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { StageItem } from './stage-artifact';
import type { WorkflowEvent } from './types';
import { exhaustedRepair, repairStuckNeed, repairTries, describeNeed } from '@/lib/agent/needs';
import { splitChangeNote } from '@/lib/agent/perform';
import { withExtraTries } from '@/components/workflow/use-go-loop';
import type { AgentStep } from '@/types/agent';

const ev = (type: WorkflowEvent['type'], stage_id: string, created_at: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type, stage_id, actor: 'user', created_at, ...extra,
});
const ids = BOOK_V1.stages.map((s) => s.id);
const upTo = (last: string) =>
  ids.slice(0, ids.indexOf(last) + 1).map((id, i) =>
    ev('stage_marked_complete', id, `2026-10-13T00:${String(i).padStart(2, '0')}:00Z`, { to_stage_id: ids[i + 1], payload: { evidence_version_id: `v-${id}` } })
  );

describe('Revision applying Continuity’s findings does not reopen Continuity', () => {
  const state = projectState(BOOK_V1, upTo('continuity'));

  it('a snapshot saved for Revision reopens only what comes after Revision', () => {
    expect(state.current_stage_id).toBe('revision');
    // Before: Continuity, which gave Revision its findings, was reopened.
    expect(laterDoneStages(BOOK_V1, state, 'drafting')).toContain('continuity');
    expect(laterDoneStages(BOOK_V1, state, laterOf(BOOK_V1, 'drafting', 'revision'))).not.toContain('continuity');
  });

  it('a save on Drafting by the user still reopens Continuity', () => {
    expect(laterOf(BOOK_V1, 'drafting', undefined)).toBe('drafting');
    expect(laterOf(BOOK_V1, 'drafting', 'objective')).toBe('drafting');
  });
});

describe('every reopening carries its reason and time', () => {
  it('completing a stage again on new evidence', () => {
    const events = [
      ...upTo('continuity'),
      ev('stage_reopened', 'drafting', '2026-10-13T01:00:00Z'),
      ev('stage_marked_complete', 'drafting', '2026-10-13T01:05:00Z', { payload: { evidence_version_id: 'v-drafting-2' } }),
    ];
    const s = projectState(BOOK_V1, events).stages.continuity;
    expect(s.status).toBe('stale');
    expect(s.stale).toMatchObject({ since: '2026-10-13T01:05:00Z', was: 'completed_with_artifact' });
    expect(s.stale?.reason).toMatch(/Drafting was completed again/);
  });

  it('going back to an earlier stage', () => {
    const events = [...upTo('continuity'), ev('stage_returned', 'revision', '2026-10-13T01:00:00Z', { to_stage_id: 'drafting' })];
    const s = projectState(BOOK_V1, events).stages.continuity;
    expect(s.stale).toMatchObject({ since: '2026-10-13T01:00:00Z' });
    expect(s.stale?.reason).toMatch(/went back to Drafting/);
  });

  it('"keep it as it is" on one stage leaves the others reopened', () => {
    const changed = ev('brief_changed', 'revision', '2026-10-13T02:00:00Z', {
      payload: { affected: [{ stage_id: 'continuity', reason: 'r' }, { stage_id: 'outline', reason: 'r' }] },
    });
    const kept = projectState(BOOK_V1, [
      ...upTo('continuity'), changed,
      ev('brief_change_dismissed', 'continuity', '2026-10-13T02:01:00Z', { payload: { change_at: changed.created_at, stage_ids: ['continuity'] } }),
    ]);
    expect(kept.stages.continuity.status).toBe('completed_with_artifact');
    expect(kept.stages.outline.status).toBe('stale');
  });
});

describe('a reopened draft in progress is answered by its next version (PINE)', () => {
  const ids1 = SINGLE_OUTPUT_V1.stages.map((s) => s.id);
  const output = 'output';
  const before = ids1.slice(0, ids1.indexOf(output)).map((id, i) =>
    ev('stage_marked_complete', id, `2026-10-13T10:0${i}:00Z`, { to_stage_id: ids1[i + 1], payload: { evidence_version_id: `v-${id}` } })
  );
  const reopened = ev('brief_changed', output, '2026-10-13T11:07:00Z', { payload: { affected: [{ stage_id: output, reason: 'measured 150 words' }] } });

  it('stays reopened until a version is saved after the change, then is in progress again', () => {
    expect(projectState(SINGLE_OUTPUT_V1, [...before, reopened]).stages[output].status).toBe('stale');
    const saved = ev('stage_version_saved', output, '2026-10-13T11:52:00Z', { actor: 'system', payload: { version_number: 7, affected: [] } });
    const s = projectState(SINGLE_OUTPUT_V1, [...before, reopened, saved]).stages[output];
    expect(s.status).toBe('in_progress');
    expect(s.stale).toBeUndefined();
  });
});

describe('a repair keeps the decided rows (screenplay Continuity)', () => {
  const before: StageItem[] = [
    { id: 'i1', finding: 'The earlier claim that the draft delivers only 1 errand no longer holds', status: 'accepted', status_source: 'user' },
    { id: 'i2', finding: 'The earlier claim that no real figure is named no longer holds', status: 'accepted', status_source: 'user' },
    { id: 'i4', finding: 'Act III breaks narrative mode' },
  ];
  const after: StageItem[] = [
    { id: 'i4', finding: 'Act III breaks narrative mode' },
    { id: 'i7', finding: 'The ledger conspiracy is never paid off' },
  ];

  it('puts dropped decided rows back, in their place, exactly as they were', () => {
    const out = restoreDecided(before, after);
    expect(out.map((r) => r.id)).toEqual(['i1', 'i2', 'i4', 'i7']);
    expect(out[0]).toEqual(before[0]);
    const json = (items: StageItem[]) => JSON.stringify({ kind: 'stage_items', items });
    expect(checkCommit({ before: json(before), after: json(out), operation: 'agent_revise' })).toBeNull();
  });

  it('says who decided the rows a refused revision dropped', () => {
    expect(decidedBy([{ id: 'a', status: 'accepted', status_source: 'user' }])).toBe('you had decided');
    expect(decidedBy([{ id: 'a', status: 'accepted', status_source: 'policy' }])).toBe('PromptMaster decided under your routine authority');
  });
});

describe('Go’s note on a repair is the version’s record, not the document (PINE)', () => {
  it('takes the "What changed" line off the text', () => {
    const { note, body } = splitChangeNote('What changed: Kept the three sections. Measured in code: Executive update: at most 120 words — 98 words.\n\n## Executive update\n\nText.');
    expect(note).toMatch(/^Kept the three sections/);
    expect(body).toBe('## Executive update\n\nText.');
    expect(splitChangeNote('## Executive update\n\nText.')).toEqual({ note: null, body: '## Executive update\n\nText.' });
  });
});

describe('a repair that did not settle is the user’s decision, with ways on', () => {
  const step = (idx: number, status: AgentStep['status'], changes: Record<string, unknown>, output: string): AgentStep =>
    ({ id: `s${idx}`, idx, stage_id: 'critique', action_key: 'recheck_stage', params: { stage_id: 'continuity' }, status, changes, output } as unknown as AgentStep);
  const events = [...upTo('critique'), ev('brief_changed', 'critique', '2026-10-13T03:00:00Z', { payload: { affected: [{ stage_id: 'continuity', reason: 'Drafting was changed (now v6) after this stage used it.' }] } })];
  const state = projectState(BOOK_V1, events);

  it('names the stage once its tries are used up', () => {
    expect(exhaustedRepair(BOOK_V1, state, ['continuity'])).toBeNull();
    expect(exhaustedRepair(BOOK_V1, state, ['continuity', 'continuity'])).toBe('continuity');
  });

  it('a repair the user stopped, or a reload cut off, is not a try (26 Oct, production)', () => {
    const steps = [
      step(0, 'cancelled', {}, 'Stopped by you before it finished. Nothing it would have produced was kept.'),
      step(1, 'interrupted', {}, 'Interrupted: the tab running this step was closed or reloaded before it finished.'),
      step(2, 'failed', {}, 'The revision dropped 2 rows you had decided.'),
    ];
    const tried = repairTries(steps, state, new Set(steps.map((s) => s.id)));
    expect(tried).toEqual(['continuity']);
    expect(exhaustedRepair(BOOK_V1, state, tried)).toBeNull();
    expect(repairStuckNeed(state, 'continuity', steps)).toMatchObject({ tries: 1, last: 'The revision dropped 2 rows you had decided.' });
  });

  it('says what is unresolved, what the last attempt did, and offers three ways on', () => {
    const need = repairStuckNeed(state, 'continuity', [
      step(0, 'succeeded', { version_ids: ['v7'] }, 'Repaired Continuity — saved.'),
      step(1, 'failed', {}, 'The revision dropped 2 rows you had decided ("a", "b"), so the current version was kept.'),
    ]);
    expect(need).toMatchObject({ kind: 'repair_stuck', stageId: 'continuity', tries: 2, saved: 1 });
    const d = describeNeed(need, (id) => (id === 'continuity' ? 'Continuity' : id));
    expect(d.message).toMatch(/What is still unresolved: Drafting was changed \(now v6\)/);
    expect(d.message).toMatch(/The last attempt: The revision dropped 2 rows/);
    expect(d.message).toMatch(/1 was saved as a new version/);
    expect(d.options?.map((o) => o.id)).toEqual(['retry', 'keep', 'open']);
  });

  it('"Try once more" grants one more try for that stage only', () => {
    expect(withExtraTries(['continuity', 'continuity', 'revision'], new Map([['continuity', 1]]))).toEqual(['continuity', 'revision']);
  });
});

describe('the record keeps saved and checked apart (screenplay record)', () => {
  it('a refused repair: not saved, with the reason', async () => {
    const { outcomeLines } = await import('@/components/workflow/agent/transparency-panel');
    const refused = { idx: 1, stage_id: 'critique', action_key: 'recheck_stage', params: { stage_id: 'continuity' }, status: 'failed', changes: {}, output: 'The revision dropped 2 rows you had decided ("a"), so the current version was kept. A retry must start from the current version.' } as unknown as AgentStep;
    expect(outcomeLines(refused, null)).toEqual({ saved: 'No — The revision dropped 2 rows you had decided ("a"), so the current version was kept', checked: '—' });
    const repaired = { ...refused, status: 'succeeded', changes: { version_ids: ['v8'], event_types: ['stage_marked_complete'] }, output: 'Repaired Continuity — saved as a new version and marked complete again.' } as unknown as AgentStep;
    expect(outcomeLines(repaired, null)).toEqual({ saved: 'Yes — 1 new version', checked: 'Passed — the stage was marked complete' });
  });
});
