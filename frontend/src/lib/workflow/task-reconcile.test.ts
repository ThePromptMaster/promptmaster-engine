import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { ProjectTask } from '@/lib/supabase/tasks';
import { statesAsCurrent } from './fact-values';
import { changeBetween, checkBorn, closing, currentTasks, openSystemTasks, stageHeads, tasksMovedPast, type StageHeads } from './task-reconcile';
import type { WorkflowEvent, WorkflowState } from './types';

/**
 * Sean's payroll cutover, 27 Nov (L-315): the pack's version 12 says North N8 is
 * the only run left; the task list held 16 open tasks from three objective
 * checks, including "Run S4 on the old system" and "Run W4 on the new system"
 * after both had run. The pack text is that version, read from his project.
 */
const PACK = readFileSync('src/lib/workflow/__fixtures__/payroll-pack-v12.md', 'utf8');
const HEAD_AT = '2026-11-27T09:42:28.450Z';

let n = 0;
function task(title: string, created_at: string, over: Partial<ProjectTask> = {}): ProjectTask {
  n += 1;
  return {
    id: `t${n}`, user_id: 'u', project_id: 'p', title, detail: '', stage: 'cutover_operating_pack', status: 'open',
    origin: 'system', origin_recommendation_id: null, created_at, resolved_at: null, ...over,
  };
}

const AT_0900 = '2026-11-27T09:00:04.000Z';
const AT_0934 = '2026-11-27T09:34:34.000Z';
const AT_0944 = '2026-11-27T09:44:20.000Z';
const SEANS_TASKS: ProjectTask[] = [
  task('Confirm the loaded file is N7 and no other North version.', AT_0900),
  task('Run N7 on the new system.', AT_0900),
  task('Confirm that no new-system completion report exists for North N7. Owner: to confirm.', AT_0900),
  task('Run S4 on the old system.', AT_0900),
  task('Run W3 on the old system.', AT_0900),
  task('Pass the new information on so the board and log can be updated.', AT_0900),
  task('File each completion report against its own division and file version.', AT_0900),
  task('Run N8 on the old system.', AT_0934),
  task('Record North as not run until a completion report for North N8 arrives.', AT_0934),
  task('Check that West has not started on the old system. Owner: to confirm.', AT_0934),
  task('Run W4 on the new system.', AT_0934),
  task('Record West as not run until a completion report for West W4 arrives.', AT_0934),
  task('Check that North has not started on the old system.', AT_0944),
  task('Confirm the loaded file is N8.', AT_0944),
  task('Run N8 on the new system.', AT_0944),
  task('a completion report for North N8 is still open.', AT_0944),
];

const HEADS: StageHeads = {
  cutover_operating_pack: { text: PACK, at: HEAD_AT, versionId: 'v12', versionNumber: 12, label: 'Cutover operating pack', prose: true },
};

describe('a task follows the sentence of the work it came from (L-315)', () => {
  it("retires every one of Sean's payroll tasks the current pack no longer says, and nothing it still says", () => {
    const retired = tasksMovedPast(SEANS_TASKS, HEADS).map((r) => r.task.title);
    expect(retired).toEqual([
      'Confirm the loaded file is N7 and no other North version.',
      'Run N7 on the new system.',
      'Confirm that no new-system completion report exists for North N7. Owner: to confirm.',
      'Run S4 on the old system.',
      'Run W3 on the old system.',
      'Record North as not run until a completion report for North N8 arrives.',
      'Check that West has not started on the old system. Owner: to confirm.',
      'Run W4 on the new system.',
      'Record West as not run until a completion report for West W4 arrives.',
    ]);
    // What stays is what the pack still asks for: the N8 run, its checks, the standing instructions.
    const kept = SEANS_TASKS.filter((t) => !retired.includes(t.title)).map((t) => t.title);
    expect(kept).not.toContain('Run S4 on the old system.');
    expect(kept.some((t) => /\bS4\b|\bW3\b|\bW4\b|\bN7\b/.test(t))).toBe(false);
  });

  it('judges a task only against a version newer than it: the latest check\'s tasks stand', () => {
    const retired = new Set(tasksMovedPast(SEANS_TASKS, HEADS).map((r) => r.task.created_at));
    expect(retired.has(AT_0944)).toBe(false);
  });

  it('reads a second time the same: a closed task is not judged again', () => {
    const first = tasksMovedPast(SEANS_TASKS, HEADS);
    const closedIds = new Set(first.map((r) => r.task.id));
    const after = SEANS_TASKS.map((t) => (closedIds.has(t.id) ? { ...t, status: 'dismissed' as const } : t));
    expect(tasksMovedPast(after, HEADS)).toEqual([]);
  });

  it('does not count a sentence kept only as history, quoted or struck through', () => {
    const text = '## Next steps\n\n- Run N8 on the new system.\n\n## History\n\n- Run S4 on the old system.\n\nSuperseded: Run W3 on the old system.\n\nThe log said "Run N7 on the new system." Then ~~Run W4 on the new system.~~';
    expect(statesAsCurrent(text, 'Run N8 on the new system.')).toBe(true);
    expect(statesAsCurrent(text, 'Run S4 on the old system.')).toBe(false);
    expect(statesAsCurrent(text, 'Run W3 on the old system.')).toBe(false);
    expect(statesAsCurrent(text, 'Run N7 on the new system.')).toBe(false);
    expect(statesAsCurrent(text, 'Run W4 on the new system.')).toBe(false);
    // A list under "Actions requested:" still states its actions.
    expect(statesAsCurrent('Actions requested:\n- Send Morgan Lee\'s contact sheet to Calder (CAL-01).', "Send Morgan Lee's contact sheet to Calder (CAL-01).")).toBe(true);
  });

  it("keeps the L-293 date rule for a task in a model's own words, and never judges a user's task", () => {
    const own = task('Tell Harbor before Tuesday, March 30', AT_0900, { detail: 'Asked: who tells Harbor?', basis: { from: 'go_record' } });
    const user = task('Run S4 on the old system.', AT_0900, { origin: 'user' });
    const heads: StageHeads = { cutover_operating_pack: { ...HEADS.cutover_operating_pack!, text: 'Tell Harbor before Tuesday, April 6.' } };
    const out = tasksMovedPast([own, user], heads);
    expect(out.map((r) => [r.task.id, r.why])).toEqual([[own.id, 'moved_past']]);
    expect(checkBorn(own)).toBe(false);
    expect(checkBorn(task('x', AT_0900))).toBe(true);
    expect(checkBorn(task('x', AT_0900, { basis: { from: 'objective_check' }, detail: 'kept' }))).toBe(true);
  });

  it('names the change before the version that moved past it', () => {
    const events: WorkflowEvent[] = [
      { type: 'brief_changed', stage_id: 'x', actor: 'user', created_at: '2026-11-27T09:37:56.000Z', payload: {
        field: 'facts', kind: 'fact',
        before: '- South S4 ran successfully on the new system at 3:10 p.m.; North and West have not run (OPS-02).',
        after: '- South S4 ran successfully on the new system at 3:10 p.m. (OPS-02); West W4 ran successfully on the new system at 3:30 p.m., and North has not run (OPS-03).',
      } },
    ];
    (events[0] as unknown as { seq: number }).seq = 52;
    const change = changeBetween(events, AT_0934, HEAD_AT);
    expect(change).toEqual({ seq: 52, at: '2026-11-27T09:37:56.000Z', what: expect.stringContaining('West W4 ran successfully on the new system at 3:30 p.m.') });
    expect(changeBetween(events, AT_0944, '2026-11-27T10:00:00.000Z')).toBeUndefined();
    const r = tasksMovedPast([task('Run W4 on the new system.', AT_0934)], HEADS, events)[0];
    expect(closing(r, { outcome: 'done', quote: 'West W4 ran successfully on the new system at 3:30 p.m.' })).toEqual({
      status: 'done',
      resolution: expect.stringMatching(/^Done: "West W4 ran successfully[^"]*" \(after: /),
      basis: expect.objectContaining({ outcome: 'done', retired_version_number: 12, change: expect.objectContaining({ seq: 52 }) }),
    });
    expect(closing(r, { outcome: 'gone' })).toMatchObject({ status: 'dismissed', resolution: expect.stringMatching(/^No longer in Cutover operating pack v12/) });
    // "done" without words that show it is only "no longer in".
    expect(closing(r, { outcome: 'done' })).toMatchObject({ status: 'dismissed', basis: { outcome: 'gone' } });
  });
});

describe('every view reads the same list', () => {
  const state = (stale: boolean): Pick<WorkflowState, 'stages'> => ({
    stages: { cutover_operating_pack: { status: 'complete', ...(stale ? { stale: { reason: 'It states "South has not run", which changed.', since: HEAD_AT, was: 'complete' as const } } : {}) } },
  });

  it('puts a task on hold while its stage is being redone, and back once it is', () => {
    const tasks = [task('Run N8 on the new system.', AT_0944), task('Chase the courier.', AT_0944, { origin: 'user' })];
    const held = currentTasks(tasks, state(true));
    expect(held.actionable.map((t) => t.title)).toEqual(['Chase the courier.']);
    expect(held.onHold.map((h) => [h.task.title, h.stageId])).toEqual([['Run N8 on the new system.', 'cutover_operating_pack']]);
    expect(openSystemTasks(tasks, state(true)).map((t) => t.title)).toEqual(['Run N8 on the new system.']);
    const back = currentTasks(tasks, state(false));
    expect(back.actionable).toHaveLength(2);
    expect(back.onHold).toEqual([]);
  });

  it('keeps what closed as history, newest first', () => {
    const tasks = [
      task('a', AT_0900, { status: 'done', resolved_at: '2026-11-27T10:00:00.000Z' }),
      task('b', AT_0900, { status: 'dismissed', resolved_at: '2026-11-27T11:00:00.000Z' }),
    ];
    expect(currentTasks(tasks, null).closed.map((t) => t.title)).toEqual(['b', 'a']);
  });
});

describe('stageHeads', () => {
  it('reads each stage\'s newest version, leaving out a manuscript and an outreach round', () => {
    const heads = stageHeads(
      { stages: [
        { id: 'a', label: 'Pack', renderer: 'prose' },
        { id: 'b', label: 'Book', renderer: 'long_form' },
        { id: 'c', label: 'Log', renderer: 'review' },
      ] as never },
      {
        a: { versions: [{ id: 'v1', version_number: 1, content: 'one', created_at: AT_0900 }, { id: 'v2', version_number: 2, content: 'two', created_at: AT_0934 }] },
        b: { versions: [{ id: 'b1', version_number: 1, content: 'x', created_at: AT_0900 }] },
        c: { versions: [{ id: 'c1', version_number: 1, content: '[]', created_at: AT_0900 }] },
      }
    );
    expect(Object.keys(heads)).toEqual(['a', 'c']);
    expect(heads.a).toMatchObject({ text: 'two', versionId: 'v2', versionNumber: 2, label: 'Pack', prose: true });
    expect(heads.c?.prose).toBe(false);
  });
});

describe('the change a closed task is about (27 Nov, production pass)', () => {
  it("names South's completion report for South's run, not West's file change saved a moment later", async () => {
    const { changeFor } = await import('./task-reconcile');
    const changes = [
      { seq: 40, at: '2026-11-27T19:24:30Z', what: 'OPS-02: South S4 ran successfully on the new system at 3:10 p.m. (completion report received). North and West have not run.' },
      { seq: 41, at: '2026-11-27T19:24:40Z', what: "REC-03: West fixed its two differences in replacement file W4; W4 is now West's final file." },
    ];
    expect(changeFor(changes, 'Run South payroll from file S4 on the new payroll system.', 'South S4 ran successfully on the new system at 3:10 p.m.')?.seq).toBe(40);
    expect(changeFor(changes, 'Run West payroll from file W3 on the old payroll system.', 'Run West payroll from file W4 on the new payroll system.')?.seq).toBe(41);
    expect(changeFor(changes.slice(1), 'anything')?.seq).toBe(41);
  });
});
