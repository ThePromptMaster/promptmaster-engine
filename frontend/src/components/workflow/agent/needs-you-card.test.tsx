import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NeedsYouCard } from './needs-you-card';

describe('NeedsYouCard: carry on with other work first (Q2c, production 9 Oct)', () => {
  const need = { kind: 'tick_criterion', stageId: 'analysis', criterionId: 'ana.verdicts', label: 'I accept the verdicts', authority: 'reserved' } as const;

  it('an approval card offers to carry on with other work first, and asks again only if nothing can proceed', () => {
    const onCarryOn = vi.fn();
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} onCarryOn={onCarryOn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Carry on with other work first' }));
    expect(onCarryOn).toHaveBeenCalledTimes(1);
  });

  it('is not offered where nothing was passed for it', () => {
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Carry on with other work first' })).toBeNull();
  });
});

describe('NeedsYouCard: an approval that is a decision offers its options (12 Nov, "Where am I supposed to select A?")', () => {
  const need = { kind: 'tick_criterion', stageId: 'cap', criterionId: 'cap.approved', label: 'I approve this decision on the cap.', authority: 'reserved' } as const;
  const offer = {
    loading: false, question: 'Raise the cap to $195,000, or keep $180,000?',
    options: [
      { label: 'Option A: raise the cap to $195,000 for both searches', quote: 'Option A: raise the cap to $195,000 per hire for both searches.' },
      { label: 'Option B: keep the $180,000 cap', quote: 'Option B: keep the approved cap of $180,000 per hire.' },
    ],
  };

  it('shows each option as a button in place of the bare approval, and choosing one gives it', async () => {
    const onChoose = vi.fn(async () => undefined);
    const onAction = vi.fn(async () => undefined);
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={onAction} offer={offer} onChoose={onChoose} />);
    expect(screen.getByText('Raise the cap to $195,000, or keep $180,000?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and resume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Option A: raise the cap to $195,000 for both searches' }));
    expect(onChoose).toHaveBeenCalledWith('Option A: raise the cap to $195,000 for both searches');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('takes a decision that is none of the options', () => {
    const onChoose = vi.fn(async () => undefined);
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} offer={offer} onChoose={onChoose} />);
    const record = screen.getByRole('button', { name: 'Record my decision and resume' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Or say what you decide instead'), { target: { value: 'Raise it for the Controller search only' } });
    fireEvent.click(record);
    expect(onChoose).toHaveBeenCalledWith('Raise it for the Controller search only');
  });

  it('holds the approval back while the options are being read', () => {
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} offer={{ loading: true, question: '', options: [] }} onChoose={async () => undefined} />);
    expect(screen.getByText('Reading the options this stage puts to you…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and resume' })).toBeNull();
  });

  it('with no options read, keeps the approval and takes what was decided with it', () => {
    const onChoose = vi.fn(async () => undefined);
    const onAction = vi.fn(async () => undefined);
    const { unmount } = render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={onAction} offer={{ loading: false, question: '', options: [] }} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and resume' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    unmount();
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={onAction} offer={{ loading: false, question: '', options: [] }} onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText('What you decide (optional). It is recorded with your approval.'), { target: { value: 'Option A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and resume' }));
    expect(onChoose).toHaveBeenCalledWith('Option A');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('a plain sign-off with no options is the one button it was', () => {
    const plain = { ...need, label: 'I accept this decision package as final.' };
    render(<NeedsYouCard need={plain} stageLabel={(id) => id} onAction={async () => undefined} offer={{ loading: false, question: '', options: [] }} onChoose={async () => undefined} />);
    expect(screen.getByRole('button', { name: 'Approve and resume' })).toBeTruthy();
    expect(screen.queryByLabelText('What you decide (optional). It is recorded with your approval.')).toBeNull();
  });

  it('a finding still undecided elsewhere is settled first, as before', () => {
    const withRow = { ...need, openRows: [{ id: 'i5', text: 'Untested assumption', severity: 'major', stageId: 'check', stageLabel: 'Check' }] };
    render(<NeedsYouCard need={withRow as never} stageLabel={(id) => id} onAction={async () => undefined} offer={offer} onChoose={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Option A: raise the cap to $195,000 for both searches' })).toBeNull();
  });
});

describe('NeedsYouCard: a finding carried forward as unmet can be settled from the stop (12 Nov)', () => {
  const need = {
    kind: 'objective_check', stageId: 'records', finding: 'work_open',
    items: ['Coverage check: carried forward, still unmet — "The no-absence assumption is untested."'],
    carried: [{ stageId: 'check', stageLabel: 'Coverage check', id: 'i5', text: 'The no-absence assumption is untested.', note: 'There are no additional absences to account for.' }],
  } as const;

  it('shows the note recorded on it and offers to settle it, work on it again, or stop', () => {
    render(<NeedsYouCard need={need as never} stageLabel={() => 'Current records'} onAction={async () => undefined} />);
    expect(screen.getByText(/Your note on i5: "There are no additional absences to account for\."/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'It is settled: carry on' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Have Go work on it again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop here' })).toBeTruthy();
  });

  it('sends the typed answer with "It is settled", and nothing with the other buttons', () => {
    const onAction = vi.fn(async () => undefined);
    render(<NeedsYouCard need={need as never} stageLabel={() => 'Current records'} onAction={onAction} />);
    fireEvent.change(screen.getByLabelText('Your answer to it (optional). It is recorded as a fact of the project.'), { target: { value: 'None expected this week.' } });
    fireEvent.click(screen.getByRole('button', { name: 'It is settled: carry on' }));
    expect(onAction).toHaveBeenCalledWith('settle_row', 'None expected this week.');
  });

  it('several carried rows keep the two buttons they had: the table is where each is decided', () => {
    const many = { ...need, items: [...need.items, 'Check: carried forward, still unmet — "Budget not shown."'], carried: [...need.carried, { ...need.carried[0], id: 'i6' }] };
    render(<NeedsYouCard need={many as never} stageLabel={() => 'Current records'} onAction={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'It is settled: carry on' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Carry on with the open work' })).toBeTruthy();
  });
});
