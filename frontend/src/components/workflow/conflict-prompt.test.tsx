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
