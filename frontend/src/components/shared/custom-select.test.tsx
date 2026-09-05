import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CustomSelect } from './custom-select';

const OPTIONS = [
  { value: 'verified', label: 'Verified' },
  { value: 'unverifiable', label: 'Unverifiable' },
  { value: 'removed', label: 'Removed' },
];

function setup(value = 'verified') {
  const onChange = vi.fn();
  render(
    <CustomSelect value={value} options={OPTIONS} onChange={onChange} ariaLabel="Claim status" />
  );
  return { onChange };
}

describe('CustomSelect', () => {
  it('is announced as a select, not a button', async () => {
    setup();
    const trigger = screen.getByRole('combobox', { name: 'Claim status' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('exposes its options and which one is chosen', async () => {
    setup();
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /Verified/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens and selects entirely from the keyboard', async () => {
    const { onChange } = setup();
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}');       // opens, lands on the current value
    await userEvent.keyboard('{ArrowDown}{Enter}'); // moves to the next, chooses it
    expect(onChange).toHaveBeenCalledWith('unverifiable');
  });

  it('opens onto the current value rather than the top of the list', async () => {
    setup('removed');
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}');
    // aria-activedescendant points at index 2, not 0.
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toMatch(/-2$/);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    setup();
    const trigger = screen.getByRole('combobox');
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not run off either end of the list', async () => {
    const { onChange } = setup('verified');
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledWith('verified');
  });
});
