/**
 * The task list as an operator meets it (L-315, 27 Nov; Sean, payroll cutover:
 * "show the operator only what they can still act on", and keep the history).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TasksPanel } from './tasks-panel';
import type { ProjectTask } from '@/lib/supabase/tasks';
import { currentTasks } from '@/lib/workflow/task-reconcile';

function task(id: string, title: string, over: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id, user_id: 'u', project_id: 'p', title, detail: '', stage: 'pack', status: 'open', origin: 'system',
    origin_recommendation_id: null, created_at: '2026-11-27T09:00:00Z', resolved_at: null, ...over,
  };
}

const name = (id: string) => ({ pack: 'Cutover operating pack', log: 'Source log' })[id] ?? id;

describe('TasksPanel', () => {
  it('shows what can be acted on, what is on hold while its stage is redone, and folds away what closed with why', async () => {
    const tasks = [
      task('a', 'Run N8 on the new system.'),
      task('b', 'Confirm the loaded file is N8.', { stage: 'log' }),
      task('c', 'Run S4 on the old system.', {
        status: 'done', resolved_at: '2026-11-27T10:00:00Z', resolved_by: 'system', resolution: 'Done',
        basis: { stage_id: 'pack', retired_version_number: 12, outcome: 'done', quote: 'South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)', change: { seq: 52, at: '2026-11-27T09:37:56Z', what: 'West W4 ran successfully on the new system at 3:30 p.m.' } },
      }),
      task('d', 'Run W3 on the old system.', {
        status: 'dismissed', resolved_at: '2026-11-27T09:59:00Z', resolved_by: 'system', resolution: 'No longer in Cutover operating pack v12',
        basis: { stage_id: 'pack', retired_version_number: 12, outcome: 'gone' },
      }),
    ];
    const view = currentTasks(tasks, { stages: { log: { status: 'stale', stale: { reason: 'It states "BANK-04", which changed.', since: '2026-11-27T09:40:00Z', was: 'complete' } } } });
    const onOpenStage = vi.fn();
    render(<TasksPanel view={view} onResolve={vi.fn()} stageName={name} onOpenStage={onOpenStage} />);

    const open = document.querySelector('[data-tasks-open]') as HTMLElement;
    expect(within(open).getByText('Run N8 on the new system.')).toBeInTheDocument();
    expect(within(open).queryByText('Confirm the loaded file is N8.')).toBeNull();
    expect(screen.getByText('1 open task')).toBeInTheDocument();

    const held = document.querySelector('[data-tasks-on-hold="log"]') as HTMLElement;
    expect(held).toHaveTextContent('On hold until Source log is updated after a change.');
    expect(within(held).getByText('Confirm the loaded file is N8.')).toBeInTheDocument();
    await userEvent.click(within(held).getByRole('button', { name: 'Open Source log' }));
    expect(onOpenStage).toHaveBeenCalledWith('log');

    const closed = document.querySelector('[data-tasks-closed]') as HTMLElement;
    expect(closed).toHaveTextContent('2 done or retired');
    expect(closed).toHaveTextContent('Done · reported done: “South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)”');
    expect(closed).toHaveTextContent('After: West W4 ran successfully on the new system at 3:30 p.m.');
    expect(closed).toHaveTextContent('Retired · no longer in Cutover operating pack v12');
  });

  it('keeps hiding itself when only the user closed tasks and nothing is open', () => {
    const { container } = render(
      <TasksPanel tasks={[task('a', 'x', { status: 'done', resolved_by: 'user' })]} onResolve={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
