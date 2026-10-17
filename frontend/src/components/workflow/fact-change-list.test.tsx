import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FactChangeList } from './fact-change-list';
import type { FactChange } from '@/lib/workflow/fact-reconcile';

const changes: FactChange[] = [
  { fact: { id: 'f1', statement: 'Launch is November 20.', subject: null, kind: 'fact' }, changes: [{ kind: 'dates', was: 'November 20', now: 'November 24' }], proposed: 'Launch is November 24.' },
  { fact: { id: 'new:0', statement: '', subject: null, kind: 'fact' }, changes: [{ kind: 'new', was: '', now: 'from your instruction — “Elena approved”' }], proposed: 'Elena approved a November 24 launch.' },
  { fact: { id: 'new:1', statement: '', subject: null, kind: 'fact' }, changes: [{ kind: 'new', was: '', now: 'from your instruction — “Omar proposes”' }], proposed: 'Omar proposes moving testing to November 20.', request: true },
];

describe('the facts review is grouped by kind (17 Oct, Sean, HARBOR)', () => {
  it('shows changed values, new facts and requests under their own headings', () => {
    render(<FactChangeList changes={changes} kept={new Set()} onToggle={() => {}} />);
    expect(within(screen.getByRole('group', { name: 'Changed values' })).getByText('Launch is November 24.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'New facts' })).getByText('Elena approved a November 24 launch.')).toBeInTheDocument();
    const requests = screen.getByRole('group', { name: 'Requests noted (not approved)' });
    expect(requests).toHaveTextContent('Omar proposes moving testing to November 20.');
    expect(requests).toHaveTextContent('Recorded as a request, not an approval');
  });

  it('shows only the groups that have something in them', () => {
    render(<FactChangeList changes={changes.slice(0, 1)} kept={new Set()} onToggle={() => {}} />);
    expect(screen.queryByRole('group', { name: 'New facts' })).toBeNull();
  });
});
