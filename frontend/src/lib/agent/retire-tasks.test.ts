import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectTask } from '@/lib/supabase/tasks';

const agentTaskOutcomes = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentTaskOutcomes: (...a: unknown[]) => agentTaskOutcomes(...a) } }));
const closeTaskBySystem = vi.fn();
const createTask = vi.fn();
vi.mock('@/lib/supabase/tasks', () => ({
  closeTaskBySystem: (...a: unknown[]) => closeTaskBySystem(...a),
  createTask: (...a: unknown[]) => createTask(...a),
}));

import { retireMovedPastTasks } from './retire-tasks';

const PACK = '## Steps\n\n1. Confirm the loaded file is N8.\n2. Run N8 on the new system once BANK-05 is recorded.\n';
const heads = { pack: { text: PACK, at: '2026-11-27T09:42:00Z', versionId: 'v12', versionNumber: 12, label: 'Pack', prose: true } };
function task(id: string, title: string): ProjectTask {
  return { id, user_id: 'u', project_id: 'p', title, detail: '', stage: 'pack', status: 'open', origin: 'system', origin_recommendation_id: null, created_at: '2026-11-27T09:00:00Z', resolved_at: null };
}
const project = { id: 'p', user_id: 'u', objective: 'Cut payroll over.', facts: [{ id: 'f1', statement: 'South S4 ran successfully on the new system at 3:10 p.m. (OPS-02).', kind: 'fact', retired_at: null }] as never };

beforeEach(() => {
  agentTaskOutcomes.mockReset();
  closeTaskBySystem.mockReset().mockImplementation(async (t: ProjectTask, c: { status: string }) => ({ ...t, status: c.status }));
  createTask.mockReset().mockImplementation(async (_p: string, _u: string, n: { title: string }) => task('new', n.title));
});

describe('retireMovedPastTasks (L-315)', () => {
  it('closes what the pack no longer says, with the label the facts support, and carries a reworded one on once', async () => {
    agentTaskOutcomes.mockResolvedValue({ outcomes: [
      { id: 't1', outcome: 'done', quote: 'South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)' },
      { id: 't2', outcome: 'reworded', now: 'Run N8 on the new system once BANK-05 is recorded.' },
      { id: 't3', outcome: 'reworded', now: 'Run N8 on both systems.' },
    ] });
    const tasks = [task('t1', 'Run S4 on the old system.'), task('t2', 'Run N8 on the new system today.'), task('t3', 'Run W3 on the old system.'), task('t4', 'Confirm the loaded file is N8.')];
    const out = await retireMovedPastTasks({ project, heads, events: [], tasks });
    expect(agentTaskOutcomes).toHaveBeenCalledTimes(1);
    const sent = agentTaskOutcomes.mock.calls[0][0];
    expect(sent.tasks.map((t: { id: string }) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(sent.facts[0].text).toContain('OPS-02');
    expect(closeTaskBySystem.mock.calls.map(([t, c]) => [t.id, c.status, c.basis.outcome])).toEqual([
      ['t1', 'done', 'done'],
      ['t2', 'dismissed', 'reworded'],
      ['t3', 'dismissed', 'gone'],
    ]);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][2]).toMatchObject({ title: 'Run N8 on the new system once BANK-05 is recorded.', basis: { from: 'reworded', replaces: 't2' }, origin_version_id: 'v12' });
    expect(closeTaskBySystem.mock.calls[1][1].basis.replaced_by).toBe('new');
    expect(out.closed).toHaveLength(3);
  });

  it('still retires every task when the label call fails, and does nothing when nothing moved', async () => {
    agentTaskOutcomes.mockRejectedValue(new Error('down'));
    await retireMovedPastTasks({ project, heads, events: [], tasks: [task('t1', 'Run S4 on the old system.')] });
    expect(closeTaskBySystem.mock.calls[0][1]).toMatchObject({ status: 'dismissed', resolution: 'No longer in Pack v12' });
    closeTaskBySystem.mockClear();
    agentTaskOutcomes.mockClear();
    await retireMovedPastTasks({ project, heads, events: [], tasks: [task('t4', 'Confirm the loaded file is N8.')] });
    expect(agentTaskOutcomes).not.toHaveBeenCalled();
    expect(closeTaskBySystem).not.toHaveBeenCalled();
  });

  it('does not add a reworded task that is already open', async () => {
    agentTaskOutcomes.mockResolvedValue({ outcomes: [{ id: 't2', outcome: 'reworded', now: 'Confirm the loaded file is N8.' }] });
    await retireMovedPastTasks({ project, heads, events: [], tasks: [task('t2', 'Check the loaded file.'), task('t4', 'Confirm the loaded file is N8.')] });
    expect(createTask).not.toHaveBeenCalled();
    expect(closeTaskBySystem.mock.calls[0][1].basis.outcome).toBe('reworded');
  });
});

describe('a replacement the work now asks for is a task at once (27 Nov, production pass)', () => {
  it('adds "Run W4 on the new system" in place of the W3 task, once', async () => {
    const pack = '## Steps\n\n1. Run West payroll from file W4 on the new payroll system.\n2. Run North payroll from file N7 on the new payroll system.\n';
    const h = { pack: { ...heads.pack, text: pack } };
    agentTaskOutcomes.mockResolvedValue({ outcomes: [{ id: 't1', outcome: 'replaced', quote: 'Run West payroll from file W4 on the new payroll system.' }] });
    await retireMovedPastTasks({ project, heads: h, events: [], tasks: [task('t1', 'Run West payroll from file W3 on the old payroll system.')] });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][2]).toMatchObject({ title: 'Run West payroll from file W4 on the new payroll system.', basis: { replaces: 't1' } });
    expect(closeTaskBySystem.mock.calls[0][1]).toMatchObject({ status: 'dismissed', basis: { outcome: 'replaced', replaced_by: 'new' } });
  });

  it('adds nothing for a replacement quoted from a fact, or one that is not an action', async () => {
    agentTaskOutcomes.mockResolvedValue({ outcomes: [{ id: 't1', outcome: 'replaced', quote: 'South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)' }] });
    await retireMovedPastTasks({ project, heads, events: [], tasks: [task('t1', 'Run S4 on the old system.')] });
    expect(createTask).not.toHaveBeenCalled();
  });
});
