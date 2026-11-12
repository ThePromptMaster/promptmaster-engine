import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionQueue } from './question-queue';
import type { QueueEntry, QueueItem } from '@/lib/agent/user-queue';

/**
 * 12 Nov (a client): "If one answer clears three blockers, Go should ask once,
 * apply the answer everywhere it matters, and keep going."
 */
const item = (over: Partial<QueueItem>): QueueItem => ({ id: 'x', kind: 'carried', stageId: 'check', stageLabel: 'Coverage check', text: 't', holdsUp: [], blocksFinish: true, ...over });
const one = (i: QueueItem): QueueEntry => ({ key: i.id, items: [i], ...(i.choices ? { choices: i.choices } : {}) });
const approval = item({ id: 'a', kind: 'approval', stageId: 'options', stageLabel: 'Options A/B', text: 'I choose the recovery option', criterionId: 'options.choice', holdsUp: ['Options A/B', 'Final package'] });
const finding = item({ id: 'f', kind: 'finding', rowId: 'i2', text: 'Named lists are missing. — suggested change: Add them.' });
const carried = item({ id: 'c', rowId: 'i5', text: 'The no-absence assumption is untested.', note: 'No absences this week.' });
const kept = item({ id: 'k', kind: 'kept_question', stageId: 'brief', stageLabel: 'Brief', stepId: 'k1', text: 'Is one trainer enough?', blocksFinish: false, choices: ['Yes', 'No, two'] });

describe('the list of what else waits on the user', () => {
  it('shows each item with what it is, where, and what it holds up', () => {
    render(<QuestionQueue entries={[one(approval), one(finding), one(carried), one(kept)]} onAnswer={async () => undefined} />);
    expect(screen.getByText('Also waiting on you')).toBeTruthy();
    expect(screen.getByText(/1\. Approval on Options A\/B · holds up Options A\/B, Final package and the finish/)).toBeTruthy();
    expect(screen.getByText(/2\. Finding i2 on Coverage check · holds up the finish/)).toBeTruthy();
    expect(screen.getByText(/3\. Finding i5 on Coverage check, carried forward as unmet/)).toBeTruthy();
    expect(screen.getByText(/4\. Question kept for you from Brief/)).toBeTruthy();
    expect(screen.getByText('Your note on it: "No absences this week."')).toBeTruthy();
  });

  it('an approval with options is given by choosing one; without, by Approve', () => {
    const onAnswer = vi.fn(async () => undefined);
    const offers = { 'options.choice': { loading: false, question: '', options: [{ label: 'Option A: take the carrier', quote: 'q' }, { label: 'Option B: move two deadlines', quote: 'q' }] } };
    const { unmount } = render(<QuestionQueue entries={[one(approval)]} offers={offers} onAnswer={onAnswer} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Option B: move two deadlines' }));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }), { kind: 'choose', choice: 'Option B: move two deadlines' });
    unmount();
    render(<QuestionQueue entries={[one(approval)]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'a' }), { kind: 'approve' });
  });

  it('a finding is accepted, or rejected with the reason typed', () => {
    const onAnswer = vi.fn(async () => undefined);
    render(<QuestionQueue entries={[one(finding)]} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText('Why you reject it (optional)'), { target: { value: 'Counts are enough here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ key: 'f' }), { kind: 'reject', reason: 'Counts are enough here.' });
  });

  it('a carried row is settled by saying so, or by an answer in words', () => {
    const onAnswer = vi.fn(async () => undefined);
    render(<QuestionQueue entries={[one(carried)]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'It is settled' }));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ key: 'c' }), { kind: 'settle' });
  });

  it('a kept question offers the answers it came with', () => {
    const onAnswer = vi.fn(async () => undefined);
    render(<QuestionQueue entries={[one(kept)]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'No, two' }));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), { kind: 'answer', text: 'No, two' });
  });

  it('items one answer settles are one question, and one answer goes to all of them', () => {
    const onAnswer = vi.fn(async () => undefined);
    const merged: QueueEntry = { key: 'c|k', items: [carried, kept], question: 'Are any absences expected that week?', choices: ['None', 'Yes'] };
    render(<QuestionQueue entries={[merged]} onAnswer={onAnswer} />);
    expect(screen.getByText('Are any absences expected that week?')).toBeTruthy();
    expect(screen.getByText(/One answer settles 2 things: Finding i5 on Coverage check, carried forward as unmet; Question kept for you from Brief/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'It is settled' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'None in any office.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledWith(merged, { kind: 'answer', text: 'None in any office.' });
  });

  it('takes one answer at a time, and says when one could not be recorded', async () => {
    let fail: (e: Error) => void = () => {};
    const onAnswer = vi.fn(() => new Promise<void>((_, reject) => {
      fail = reject;
    }));
    render(<QuestionQueue entries={[one(carried), one(kept)]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'It is settled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    fail(new Error('Could not save the table.'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save the table.'));
  });

  it('shows nothing when nothing else is waiting', () => {
    const { container } = render(<QuestionQueue entries={[]} onAnswer={async () => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('says what an answer was recorded for and did not settle', async () => {
    const merged: QueueEntry = { key: 'c|k', items: [carried, kept], question: 'Are any absences expected that week?', choices: ['None', 'I will confirm later'] };
    const onAnswer = vi.fn(async () => ({ open: [carried] }));
    render(<QuestionQueue entries={[merged]} onAnswer={onAnswer} />);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I will confirm later' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Your answer is recorded. It does not settle this, which still waits for its own answer: Finding i5 on Coverage check, carried forward as unmet.'
    ));
    // An answer that settles all of it says nothing more.
    onAnswer.mockResolvedValueOnce({ open: [] });
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
