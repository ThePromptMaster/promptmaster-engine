import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FeedbackPanel } from './admin-dashboard';
import type { AdminFeedbackRow, AdminOverview } from '@/lib/admin/types';

function overview(feedback: AdminFeedbackRow[], total = feedback.length): AdminOverview {
  return {
    windowDays: 30,
    generatedAt: '2026-10-09T12:00:00Z',
    totals: {
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      unpricedCalls: 0,
      activeUsers: 0,
      failedJobs: 0,
      errors: 0,
      feedback: total,
    },
    usageByUser: [],
    usageByOperation: [],
    usageByProject: [],
    failedJobs: [],
    recentErrors: [],
    errorTally: [],
    feedback,
    warnings: [],
  };
}

const ROW: AdminFeedbackRow = {
  id: 'fb-1',
  userEmail: 'tester@example.test',
  projectTitle: 'Tidal Energy Handbook',
  useCase: 'Drafting the market chapter',
  value: 'The outline stage',
  blockage: '',
  reuseLikelihood: null,
  createdAt: new Date().toISOString(),
};

describe('FeedbackPanel', () => {
  it('shows each answer, who gave it and on which project', () => {
    render(<FeedbackPanel overview={overview([{ ...ROW, reuseLikelihood: 4 }])} />);

    expect(screen.getByText('Drafting the market chapter')).toBeInTheDocument();
    expect(screen.getByText('The outline stage')).toBeInTheDocument();
    expect(screen.getByText('4/5')).toBeInTheDocument();
    expect(screen.getByText('tester@example.test')).toBeInTheDocument();
    expect(screen.getByText('Tidal Energy Handbook')).toBeInTheDocument();
    expect(screen.getByText(/1 submission in all/)).toBeInTheDocument();
  });

  it('shows an unanswered question as a dash, never as a score', () => {
    render(<FeedbackPanel overview={overview([ROW])} />);
    // Blank "stuck" answer and unanswered reuse score.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('says plainly when nothing has come in', () => {
    render(<FeedbackPanel overview={overview([])} />);
    expect(screen.getByText('No feedback yet.')).toBeInTheDocument();
  });

  it('says when the list is only the newest part of a longer total', () => {
    render(<FeedbackPanel overview={overview([ROW], 250)} />);
    expect(screen.getByText(/250 submissions in all.*The newest 1 are listed/)).toBeInTheDocument();
  });
});
