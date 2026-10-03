import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExitCriteriaChecklist } from './exit-criteria-checklist';

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
