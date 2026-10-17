import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GoTerms } from './authorization-dialog';
import { DEFAULT_AUTO_WINDOWS } from '@/lib/agent/authorize';
import { DEFAULT_BUDGET_STEPS } from '@/lib/agent/policy';

describe('Go in one click, the largest window by default (17 Oct, Sean: emails 9 and 12)', () => {
  it('defaults to 25 steps and 3 further windows', () => {
    expect(DEFAULT_BUDGET_STEPS).toBe(25);
    expect(DEFAULT_AUTO_WINDOWS).toBe(3);
  });

  it('says what Go may do in one line, with the further windows beside it and the full terms folded', async () => {
    const onAutoWindows = vi.fn();
    render(<GoTerms policy="autonomous" budget={25} autoWindows={3} onAutoWindows={onAutoWindows} />);
    const terms = screen.getByLabelText('What Go may do');
    expect(terms).toHaveTextContent('Go works through the stages and stops when it needs you. Finishing the project is always your click. Pressing Go is recorded on the decision trail.');
    expect((screen.getByLabelText('Further windows without asking') as HTMLSelectElement).value).toBe('3');
    await userEvent.setup().selectOptions(screen.getByLabelText('Further windows without asking'), '20');
    expect(onAutoWindows).toHaveBeenCalledWith(20);
    expect(screen.getByText('Everything Go may and may not do')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Checkpoint has no further windows to choose', () => {
    render(<GoTerms policy="checkpoint" budget={25} onAutoWindows={() => {}} />);
    expect(screen.queryByLabelText('Further windows without asking')).toBeNull();
    expect(screen.getByLabelText('What Go may do')).toHaveTextContent('stops for your approval before important moves');
  });
});
