import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { approvedVersions, ExitCriteriaChecklist } from './exit-criteria-checklist';

const auto = { id: 'a', label: 'Every finding resolved or dismissed', satisfied: false, blocking: false };
const approve = { id: 'm', label: 'I approve this review', satisfied: false, blocking: true, manual: true };

describe('the checklist folds on a check stage (3 Oct call)', () => {
  it('is one line until opened when nothing needs the user', async () => {
    const user = userEvent.setup();
    render(<ExitCriteriaChecklist criteria={[auto]} onToggleManual={() => {}} collapsible />);
    expect(screen.getByText('Every finding resolved or dismissed')).not.toBeVisible();
    expect(screen.getByText(/0 of 1 done/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /To finish this stage/ }));
    expect(screen.getByText('Every finding resolved or dismissed')).toBeVisible();
  });

  it('stays open on a stage with a box only the user can tick', () => {
    render(<ExitCriteriaChecklist criteria={[auto, approve]} onToggleManual={() => {}} collapsible />);
    expect(screen.getByRole('checkbox', { name: /I approve this review/ })).toBeInTheDocument();
  });

  it('never folds where it is not asked to', () => {
    render(<ExitCriteriaChecklist criteria={[auto]} onToggleManual={() => {}} />);
    expect(screen.getByText('Every finding resolved or dismissed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /To finish this stage/ })).not.toBeInTheDocument();
  });
});

describe('an approval says which version it was given on (19 Oct)', () => {
  const versions = [{ id: 'v3', version_number: 3 }, { id: 'v4', version_number: 4 }];

  it('only an approval given on an earlier version than the current one is listed', () => {
    expect(approvedVersions(versions, { m: 'v3', other: 'v4', gone: 'v1' })).toEqual({ m: { approved: 3, current: 4 } });
    expect(approvedVersions([], { m: 'v3' })).toEqual({});
  });

  it('the ticked box says "approved v3 · current v4"', () => {
    render(
      <ExitCriteriaChecklist
        criteria={[{ ...approve, satisfied: true }]}
        onToggleManual={() => {}}
        approvedVersions={approvedVersions(versions, { m: 'v3' })}
      />
    );
    expect(screen.getByText('approved v3 · current v4')).toBeInTheDocument();
  });
});

describe('finishing from the acceptance box (Sean, 22 Oct)', () => {
  const accept = { id: 'summary.accepted', label: 'I accept this output as finished', satisfied: false, blocking: false, manual: true };

  it('offers Finish beside the box once it is ticked, and not before', async () => {
    const onFinish = vi.fn();
    const { rerender } = render(<ExitCriteriaChecklist criteria={[accept]} onToggleManual={() => {}} onFinish={onFinish} />);
    expect(screen.queryByRole('button', { name: /Finish — see your finished work/ })).not.toBeInTheDocument();
    rerender(<ExitCriteriaChecklist criteria={[{ ...accept, satisfied: true }]} onToggleManual={() => {}} onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: /Finish — see your finished work/ }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('is not offered where the stage cannot be worked on', () => {
    render(<ExitCriteriaChecklist criteria={[{ ...accept, satisfied: true }]} onToggleManual={() => {}} onFinish={() => {}} readOnly />);
    expect(screen.queryByRole('button', { name: /Finish/ })).not.toBeInTheDocument();
  });
});

describe('an approval that is a decision is given by choosing (12 Nov)', () => {
  // A reserved approval carries no authority on its result: only a delegable one is marked.
  const decision = { id: 'cap.approved', label: 'I approve this decision on the cap.', satisfied: false, blocking: true, manual: true };
  const offers = {
    'cap.approved': {
      loading: false, question: 'Raise the cap or keep it?',
      options: [{ label: 'Option A: $195,000 for both searches', quote: 'Option A: raise the cap to $195,000.' }, { label: 'Option B: keep $180,000', quote: 'Option B: keep $180,000.' }],
    },
  };

  it('offers the options under the approval, and the bare box no longer gives it', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn(async () => undefined);
    const onToggleManual = vi.fn();
    render(<ExitCriteriaChecklist criteria={[decision]} onToggleManual={onToggleManual} offers={offers} onDecide={onDecide} />);
    expect((screen.getByRole('checkbox', { name: /I approve this decision on the cap/ }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Option B: keep $180,000' }));
    expect(onDecide).toHaveBeenCalledWith('cap.approved', 'Option B: keep $180,000');
    expect(onToggleManual).not.toHaveBeenCalled();
  });

  it('says what was decided once the approval is given', () => {
    render(<ExitCriteriaChecklist criteria={[{ ...decision, satisfied: true }]} onToggleManual={() => {}} offers={{}} decided={{ 'cap.approved': 'Option A: $195,000 for both searches' }} onDecide={async () => undefined} />);
    expect(screen.getByText('Decided: Option A: $195,000 for both searches')).toBeInTheDocument();
  });

  it('an approval with no options is the box it was, and a routine one is never offered options', async () => {
    const user = userEvent.setup();
    const onToggleManual = vi.fn();
    const routine = { ...decision, id: 'r', label: 'The figures match', authority: 'delegable' as const };
    render(<ExitCriteriaChecklist criteria={[decision, routine]} onToggleManual={onToggleManual} offers={{ r: offers['cap.approved'] }} onDecide={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Option B: keep $180,000' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /I approve this decision on the cap/ }));
    expect(onToggleManual).toHaveBeenCalledWith('cap.approved', true);
  });
});
