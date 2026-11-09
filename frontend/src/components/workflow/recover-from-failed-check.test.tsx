import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueRevisionJobs = vi.fn(async () => ['s1']);
vi.mock('@/lib/jobs/sections', async (actual) => ({ ...(await actual<typeof import('@/lib/jobs/sections')>()), enqueueRevisionJobs: (...a: unknown[]) => (enqueueRevisionJobs as (...x: unknown[]) => unknown)(...a) }));
vi.mock('@/lib/supabase/jobs', async (actual) => ({ ...(await actual<typeof import('@/lib/supabase/jobs')>()), listProjectJobs: vi.fn(async () => []) }));
vi.mock('@/hooks/use-job-drain', () => ({ useJobDrain: () => undefined }));

import type { NeedsUser } from '@/lib/agent/needs';
import { nextAction, type NextActionInput } from '@/lib/workflow/next-step';

import { NeedsYouCard } from './agent/needs-you-card';
import { LongFormRenderer } from './renderers/long-form-renderer';
import type { StageRendererProps } from './renderers/types';

const stuck: NeedsUser = { kind: 'repair_stuck', stageId: 'plan', why: 'the budget changed', last: 'Couldn’t finish repairing Core plan: the new version still gives Training: $8,000.', tries: 2, saved: 1 } as NeedsUser;
const label = () => 'Core plan';

describe('a failed repair can be told what to fix (8 Nov, production)', () => {
  it('names what failed, and the box turns the one primary button into the correction', async () => {
    const onAction = vi.fn(async () => undefined);
    render(<NeedsYouCard need={stuck} stageLabel={label} onAction={onAction} />);
    expect(screen.getByText(/still gives Training: \$8,000/)).toBeTruthy();
    const box = screen.getByLabelText(/Tell Go what to fix/) as HTMLTextAreaElement;
    expect(screen.queryByRole('button', { name: 'Fix this and check again' })).toBeNull();
    fireEvent.change(box, { target: { value: 'The training line is correct; only migration changed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix this and check again' }));
    expect(onAction).toHaveBeenCalledWith('retry', 'The training line is correct; only migration changed.');
  });

  it('with nothing typed it is the plain retry, and a stage Go cannot revise has no box', () => {
    const onAction = vi.fn(async () => undefined);
    const { unmount } = render(<NeedsYouCard need={stuck} stageLabel={label} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try once more from the current version' }));
    expect(onAction).toHaveBeenCalledWith('retry', undefined);
    unmount();
    render(<NeedsYouCard need={{ ...stuck, byHand: true } as NeedsUser} stageLabel={label} onAction={onAction} />);
    expect(screen.queryByLabelText(/Tell Go what to fix/)).toBeNull();
  });
});

describe('"Apply and continue" is not offered beside a failed repair', () => {
  const base: NextActionInput = { finalized: false, canAct: true, heldChanges: 0, reopenedHere: true, reopenedLabel: 'Documents', awaitingUpdate: ['Documents'], goActive: false, run: { status: 'awaiting_decision', ended_at: null, hasNeed: true, asking: false }, onCurrentStage: false };

  it('on another stage the next step leads to Go’s card', () => {
    expect(nextAction({ ...base, repairFailed: true })).toMatchObject({ kind: 'answer_go' });
  });

  it('on the stage with Go’s card, the card is the next step', () => {
    expect(nextAction({ ...base, repairFailed: true, onCurrentStage: true })).toBeNull();
  });

  it('without a failed repair a reopened stage is still "Apply and continue"', () => {
    expect(nextAction(base)).toMatchObject({ kind: 'apply_continue_reopened' });
  });
});

describe('one section can be changed from the list (8 Nov: "Change it was disabled")', () => {
  const section = { id: 's1', title: 'Training plan', abstract: 'Who is trained when.', status: 'complete', content: 'Eight sessions.', revision: 1 };
  const props = (readOnly: boolean) => ({
    readOnly,
    versions: [], activeVersionId: null, onSelectVersion: () => undefined, evaluation: null,
    longForm: { project: { id: 'p', user_id: 'u', mode: 'architect' }, artifactId: 'a', stageId: 'docs', state: { outline: [section] }, approvedOutlineVersionId: 'o1', onRefresh: () => undefined, appendManuscriptVersion: async () => ({ id: 'snap' }) },
  }) as unknown as StageRendererProps;

  beforeEach(() => enqueueRevisionJobs.mockClear());

  it('rewrites that section alone, to what was typed', async () => {
    render(<LongFormRenderer {...props(false)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change this section' }));
    const send = screen.getByRole('button', { name: 'Rewrite this section' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-change-section]') as HTMLTextAreaElement, { target: { value: 'Use the Core plan allocation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite this section' }));
    await vi.waitFor(() => expect(enqueueRevisionJobs).toHaveBeenCalledOnce());
    const arg = (enqueueRevisionJobs.mock.calls as unknown as [{ targets: { section: { id: string } }[]; brief: { instruction: string } }][])[0][0];
    expect(arg.targets.map((t) => t.section.id)).toEqual(['s1']);
    expect(arg.brief.instruction).toContain('Use the Core plan allocation.');
  });

  it('is not offered on a read-only view', () => {
    render(<LongFormRenderer {...props(true)} />);
    expect(screen.queryByRole('button', { name: 'Change this section' })).toBeNull();
  });
});
