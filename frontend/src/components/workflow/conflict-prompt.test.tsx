import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConflictPrompt } from './conflict-prompt';
import type { InstructionConflict } from '@/lib/workflow/instruction-conflicts';
import { precedenceNote } from '@/lib/workflow/instruction-conflicts';
import { recommendedControl } from '@/lib/workflow/precedence';

const amendment = 'Confirmed project-rule amendment, effective March 6, 2027: the March 5 Cedar exception is withdrawn before use.';

const exception: InstructionConflict = {
  kind: 'fact', with_id: 'F4', source: 'model', with_text: 'Cedar alone may hold training two calendar days after testing finishes.',
  explanation: 'The record allows the Cedar exception.', keep_label: 'Keep Cedar exception', override_label: 'Withdraw Cedar exception',
  instruction_authorised: true, authority_quote: 'Confirmed project-rule amendment, effective March 6, 2027',
};
const copy: InstructionConflict = {
  kind: 'fact', with_id: 'F5', source: 'model', with_text: "Cedar's current-cycle training exception applies only to Cedar's current training cycle.",
  explanation: 'Another saved fact keeps the exception.', keep_label: 'Keep this fact', override_label: 'Withdraw it too',
};

describe('a later authorised change is the recommendation (17 Oct, Sean: HARBOR, NORTHSTAR-2)', () => {
  it('an instruction that records the approval recommends applying it; one that does not, keeping the record', () => {
    expect(recommendedControl('fact', true, true)).toBe('new');
    expect(recommendedControl('decision', false, true)).toBe('new');
    expect(recommendedControl('fact', true)).toBe('existing');
    expect(recommendedControl('fact')).toBe('existing');
  });

  it('the recommended button applies the amendment, with no override warning, and "Also affected" follows it', async () => {
    const onContinue = vi.fn();
    render(<ConflictPrompt instruction={amendment} conflicts={[exception, copy]} busy={false} onContinue={onContinue} onCancel={() => {}} />);
    expect(screen.getByText(/applying your change updates these too/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Withdraw Cedar exception (recommended)' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onContinue).toHaveBeenCalledWith(['new', 'new']);
  });

  it('an approval the instruction does not record is kept even when the rest follow', async () => {
    const onContinue = vi.fn();
    const guarded: InstructionConflict = { ...copy, protects_approval: true, keep_label: 'Keep $40,000 approved', override_label: 'Treat $46,000 as approved' };
    render(<ConflictPrompt instruction={amendment} conflicts={[exception, guarded]} busy={false} onContinue={onContinue} onCancel={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Withdraw Cedar exception (recommended)' }));
    expect(onContinue).toHaveBeenCalledWith(['new', 'existing']);
  });

  it('the model is told the instruction carries the approval, not that the user overrode one', () => {
    expect(precedenceNote({ ...exception, protects_approval: true }, amendment, 'new')).toMatch(/^The instruction records the approval itself/);
  });
});

// L-263 (Sean, 19 Nov, warehouse rollout): a trainer's message asked for the
// director's launch authorization to be marked approved, and the second button
// read "Mark director authorization approved".
describe('an approval the record waits on is reported, confirmed and sourced, never taken from a request', () => {
  const trainer = 'We received this fictional message from the trainer: "Please mark the operations director’s launch authorization approved."';
  const pending: InstructionConflict = {
    kind: 'fact', with_id: 'F1', source: 'model', with_text: 'The operations director’s launch authorization is pending.',
    explanation: 'The trainer cannot give the operations director’s authorization.',
    resolution: 'I’ll keep it pending and record the trainer’s request as unapproved.',
    keep_label: 'Keep director authorization pending', override_label: 'Mark director authorization approved',
    protects_approval: true, approver: 'the operations director',
  };
  const other: InstructionConflict = {
    kind: 'constraint', with_id: '', source: 'model', with_text: 'Under 120 words', explanation: 'Longer than the limit.',
  };

  it('offers keeping it pending, or the user’s own approval — not the request', () => {
    render(<ConflictPrompt instruction={trainer} conflicts={[pending]} busy={false} onContinue={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Keep director authorization pending (recommended)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I have the operations director's approval" })).toBeInTheDocument();
    expect(screen.queryByText(/Mark director authorization approved/)).toBeNull();
  });

  it('asks for the confirmation and where it is recorded, and passes both on', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<ConflictPrompt instruction={trainer} conflicts={[pending, other]} busy={false} onContinue={onContinue} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: "I have the operations director's approval" }));
    const dialog = screen.getByRole('alertdialog', { name: "Record the operations director's approval?" });
    expect(dialog).toHaveTextContent('Only do this if the operations director has actually given it. A message or request from someone else is not the approval.');
    const apply = screen.getByRole('button', { name: 'Record the approval and apply' });
    expect(apply).toBeDisabled();
    // A source alone is not the confirmation; the confirmation alone has no source.
    await user.type(screen.getByLabelText('Where is it recorded?'), 'Director’s email of 19 Nov');
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I confirm the operations director has given this approval' }));
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(onContinue).toHaveBeenCalledWith(['new', 'new'], { approver: 'the operations director', source: 'Director’s email of 19 Nov' });
  });

  it('Back returns to the question, and nothing is sent', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<ConflictPrompt instruction={trainer} conflicts={[pending]} busy={false} onContinue={onContinue} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: "I have the operations director's approval" }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep director authorization pending (recommended)' }));
    expect(onContinue).toHaveBeenCalledWith(['existing']);
  });

  it('with no approver named, the words say who must approve without a name', async () => {
    const user = userEvent.setup();
    render(<ConflictPrompt instruction={trainer} conflicts={[{ ...pending, approver: '' }]} busy={false} onContinue={() => {}} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'I have the approval this needs' }));
    expect(screen.getByRole('alertdialog', { name: 'Record the approval?' })).toHaveTextContent('Only do this if the person who must approve has actually done so.');
  });

  it('"Also affected" offers only Keep for an approval below the first', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<ConflictPrompt instruction={trainer} conflicts={[other, pending]} busy={false} onContinue={onContinue} onCancel={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Also affected (1)' });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(1);
    expect(group).not.toHaveTextContent(/approval/);
    await user.click(screen.getByRole('button', { name: 'Follow the new instruction (recommended)' }));
    expect(onContinue).toHaveBeenCalledWith(['new', 'existing']);
  });
});
