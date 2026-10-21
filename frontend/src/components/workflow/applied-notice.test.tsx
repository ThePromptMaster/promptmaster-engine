import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AppliedNotice } from './chat-panel';

const base = { scope: 'Whole document', canUndo: true, busy: false, onUndo: vi.fn(), onDismiss: vi.fn() };

describe('after "Change it", the note says whether anything else needs updating (14 Oct call)', () => {
  it('names the later work waiting for an update and the button that does it', () => {
    render(<AppliedNotice {...base} awaitingUpdate={['Final review', 'Summary']} />);
    expect(screen.getByRole('region', { name: 'Revision applied' })).toHaveTextContent(/Final review, Summary — needs updating\. Press Apply and continue/);
  });

  it('says plainly when nothing else needs updating', () => {
    render(<AppliedNotice {...base} awaitingUpdate={[]} />);
    expect(screen.getByText(/nothing else needs updating/)).toBeInTheDocument();
  });

  it('calls its close button what it does: the new version is kept', () => {
    render(<AppliedNotice {...base} />);
    expect(screen.getByRole('button', { name: 'Keep this version' })).toBeInTheDocument();
  });
});
