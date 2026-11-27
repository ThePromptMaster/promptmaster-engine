import { describe, expect, it } from 'vitest';

import type { ProjectTask } from '@/lib/supabase/tasks';
import { staleTasks } from './stale-tasks';

const task = (over: Partial<ProjectTask>): ProjectTask => ({
  id: 't', user_id: 'u', project_id: 'p', title: '', detail: '', stage: 'operations_plan', status: 'open', origin: 'system',
  origin_recommendation_id: null, created_at: '2026-11-26T22:55:00+00:00', resolved_at: null, ...over,
});

// 27 Nov, production pass (ops plan example): what "Carried forward" held after three date changes.
const placeholder = task({ id: 'a', created_at: '2026-11-26T22:10:00+00:00', title: 'The commitment still carries the placeholder **[New chilled room delivery address]**. It can be sent only after the address is filled in. Owner: to confirm.' });
const harbor = task({ id: 'b', created_at: '2026-11-26T22:10:00+00:00', title: 'To move it at no cost, tell Harbor at least 7 days before its booking starts.' });
const march30 = task({ id: 'c', title: 'Before that date, confirm the name and phone number of the person who will receive their chilled orders on Tuesday, March 30, 2027.' });
const april20 = task({ id: 'd', created_at: '2026-11-27T09:26:00+00:00', title: 'Before that date, confirm the name and phone number of the person who will receive their chilled orders on Tuesday, April 20, 2027.' });

const plan = { text: '| Customer switch | Tuesday, April 20 | Bayview Grocers |\nTell Harbor at least 7 days before the booking starts.', at: '2026-11-27T09:25:50+00:00' };
const commitment = { text: 'Your chilled orders move to the new room on Tuesday, April 20, 2027. Please confirm a receiving contact.', at: '2026-11-27T09:25:30+00:00' };

describe('tasks an objective check recorded that the work has moved past (27 Nov)', () => {
  it('a date the stage no longer states, and a placeholder no stage holds, are stale', () => {
    const stale = staleTasks([placeholder, harbor, march30, april20], { operations_plan: plan, customer_commitment: commitment });
    expect(stale.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('a task with no date or placeholder is kept, and so is one the stage still states', () => {
    expect(staleTasks([harbor, april20], { operations_plan: plan })).toEqual([]);
  });

  it('nothing is judged until the stage has changed since the task was made', () => {
    expect(staleTasks([march30], { operations_plan: { ...plan, at: '2026-11-26T22:50:00+00:00' } })).toEqual([]);
  });

  it('only open tasks Go recorded, on a stage with text', () => {
    expect(staleTasks([{ ...march30, origin: 'user' }, { ...march30, status: 'done' }, { ...march30, stage: null }], { operations_plan: plan })).toEqual([]);
    expect(staleTasks([march30], { operations_plan: { text: ' ', at: plan.at } })).toEqual([]);
    expect(staleTasks([march30], {})).toEqual([]);
  });
});
