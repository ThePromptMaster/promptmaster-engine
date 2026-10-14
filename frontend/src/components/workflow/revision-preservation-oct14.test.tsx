/**
 * 14 Oct (Sean, workshop and wedding speech): the revision card says what the
 * revision would have dropped without being asked (kept, with a way to let it
 * go), and which personal details it added that nobody supplied.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ProposalCard } from './chat-panel';

describe('the revision card keeps what was not asked to change', () => {
  it('names the lines it kept, and lets the user remove them anyway', () => {
    const onToggle = vi.fn();
    render(
      <ProposalCard scopeLabel="Document" before="old" after="new" canApply busy={false}
        putBack={['Hello,', 'Best,', 'Maya', '- Confirm 12 attendees.']} putBackKept onTogglePutBack={onToggle}
        onAccept={() => undefined} onDiscard={() => undefined} />
    );
    expect(screen.getByLabelText('Kept from before').textContent).toMatch(
      /Kept “Hello,”, “Best,”, “Maya” and “Confirm 12 attendees.”: the revision dropped them, and your instruction did not ask for that./
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove them anyway' }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('names the details nobody supplied, and offers to take them out', () => {
    const onRemove = vi.fn();
    render(
      <ProposalCard scopeLabel="Document" before="old" after="new" canApply busy={false}
        addedClaims={[{ quote: 'a lifelong pattern of Emma being the organized one', why: 'not supplied' }]}
        onRemoveClaims={onRemove} onAccept={() => undefined} onDiscard={() => undefined} />
    );
    const box = screen.getByLabelText('Details you did not supply');
    expect(box.textContent).toMatch(/You asked not to invent any/);
    expect(box.textContent).toMatch(/“a lifelong pattern of Emma being the organized one” — not supplied/);
    fireEvent.click(screen.getByRole('button', { name: 'Take these out' }));
    expect(onRemove).toHaveBeenCalled();
  });
});
