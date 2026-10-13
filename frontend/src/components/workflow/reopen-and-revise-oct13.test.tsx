/**
 * 13 Oct (Sean, emails 1, 2.12 and 6): Go's authorization says what it may
 * finish and how windows are authorised; a revision shows what changed, can be
 * adjusted, and reports what was checked on the saved text.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { windowsLine } from './agent/authorization-dialog';
import { POLICY_TERMS } from '@/lib/agent/authorize';
import { AppliedNotice, ProposalCard } from './chat-panel';

describe('Go authorization wording (12.12)', () => {
  it('says finishing the project is the user’s click, without "cannot finish"', () => {
    const terms = POLICY_TERMS.autonomous.join(' ');
    expect(terms).toMatch(/complete every stage and check the objective/);
    expect(terms).toMatch(/"Finish project" — is always your click/);
    expect(terms).not.toMatch(/cannot finish the project/);
  });

  it('says what happens at the end of a window as the dropdown sets it', () => {
    expect(windowsLine('autonomous', 12, 0)).toMatch(/each further window is your click/);
    expect(windowsLine('autonomous', 12, 2)).toMatch(/authorising 2 more windows now: when one is used up it starts the next without asking/);
    expect(windowsLine('autonomous', 12, 2)).not.toMatch(/each further window is your click, and is recorded\./);
    expect(windowsLine('autonomous', 12, 20)).toMatch(/up to 20 more windows/);
    expect(windowsLine('checkpoint', 12, 3)).toMatch(/each further window is your click/);
  });
});

describe('the revision card (email 6)', () => {
  it('shows what changed, and Adjust goes back to the instruction', () => {
    const onAdjust = vi.fn();
    render(
      <ProposalCard scopeLabel="The executive update" before="old" after="new" canApply busy={false}
        summary="Shortened the update to 96 words; tracker and log unchanged."
        onAccept={() => undefined} onAdjust={onAdjust} onDiscard={() => undefined} />
    );
    expect(screen.getByLabelText('What changed').textContent).toMatch(/Shortened the update to 96 words/);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    expect(onAdjust).toHaveBeenCalled();
  });

  it('after applying, says what was checked on the saved text, and when it applied on its own', () => {
    render(
      <AppliedNotice scope="Document" summary="Shortened the update." auto
        checks={[{ label: 'Executive update: at most 120 words — 96 words', ok: true }]}
        canUndo busy={false} onUndo={() => undefined} onDismiss={() => undefined} />
    );
    expect(screen.getByText(/under your routine-decision authority/)).toBeTruthy();
    expect(screen.getByLabelText('Checked on the saved text').textContent).toMatch(/96 words/);
    expect(screen.getByRole('button', { name: 'Restore the previous version' })).toBeTruthy();
  });
});
