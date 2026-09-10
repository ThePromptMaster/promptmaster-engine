import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EvaluationRatings } from './evaluation-ratings';
import { StageEvaluationPanel } from './evaluation-panel';
import { findingDimension, ratingDisplay } from '@/lib/workflow/evaluation-display';
import type { Evaluation } from '@/types/project';
import type { AuditFinding } from '@/types';

/**
 * Section 8: "Show each rating with explanation, affected area, and corrective
 * action rather than numbers alone."
 *
 * The three `*_explanation` columns have been written by the evaluator and read
 * by nothing since M4.1. These tests pin them to the screen, because a stored
 * column with no reader is exactly the kind of thing a refactor deletes.
 */
function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    user_id: 'u1',
    project_id: 'p1',
    version_id: 'v1',
    alignment_score: 'High',
    alignment_explanation: 'It answers the stage instruction directly.',
    drift_score: 'Low',
    drift_explanation: 'Stays inside the objective and the approved outline.',
    clarity_score: 'Medium',
    clarity_explanation: 'The middle third buries its point in subordinate clauses.',
    completeness_status: 'complete',
    completeness_reason: null,
    interpretation: null,
    findings: [],
    needs_realignment: false,
    evaluator_model: 'openai/gpt-5.4',
    source: 'pipeline',
    created_at: '',
    ...overrides,
  };
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'f1',
    category: 'Clarity',
    summary: 'Paragraph four states the thesis twice.',
    suggested_change: 'Cut the second statement of the thesis.',
    ...overrides,
  };
}

describe('EvaluationRatings — each rating carries its own explanation', () => {
  it('renders a distinct explanation for alignment, clarity and drift', () => {
    render(<EvaluationRatings evaluation={evaluation()} />);

    const alignment = screen.getByLabelText('Alignment rating');
    const clarity = screen.getByLabelText('Clarity rating');
    const drift = screen.getByLabelText('Drift rating');

    // The load-bearing assertion: each explanation appears under its OWN
    // rating, not merely somewhere on the page. One shared corrective action
    // for the whole evaluation is what section 8 rules out.
    expect(alignment).toHaveTextContent('It answers the stage instruction directly.');
    expect(clarity).toHaveTextContent('The middle third buries its point');
    expect(drift).toHaveTextContent('Stays inside the objective and the approved outline.');

    expect(alignment).not.toHaveTextContent('The middle third buries its point');
    expect(drift).not.toHaveTextContent('It answers the stage instruction directly.');
  });

  it('gives every rating an affected area and a corrective action', () => {
    render(<EvaluationRatings evaluation={evaluation()} />);

    for (const label of ['Alignment rating', 'Clarity rating', 'Drift rating']) {
      const card = screen.getByLabelText(label);
      expect(within(card).getByText('Affected area')).toBeInTheDocument();
      expect(within(card).getByText('Corrective action')).toBeInTheDocument();
    }
  });

  it('shows completeness as a rating of its own, reason included', () => {
    // Force-set to incomplete when the model hit its token limit — the single
    // most actionable thing an evaluation can say, previously a stray line.
    render(
      <EvaluationRatings
        evaluation={evaluation({
          completeness_status: 'incomplete',
          completeness_reason: 'Output stopped mid-sentence at the token limit.',
        })}
      />
    );
    const card = screen.getByLabelText('Completeness rating');
    expect(card).toHaveTextContent('incomplete');
    expect(card).toHaveTextContent('Output stopped mid-sentence at the token limit.');
  });

  it('files a finding as the corrective action of the rating it speaks to', () => {
    render(
      <EvaluationRatings
        evaluation={evaluation({ findings: [finding()] })}
      />
    );
    const clarity = screen.getByLabelText('Clarity rating');
    expect(clarity).toHaveTextContent('Cut the second statement of the thesis.');
    expect(clarity).toHaveTextContent('Paragraph four states the thesis twice.');

    // And nowhere else: a finding shown under a dimension it does not belong
    // to makes that rating look explained when it is not.
    expect(screen.getByLabelText('Alignment rating')).not.toHaveTextContent(
      'Cut the second statement'
    );
  });

  it('surfaces an unattributable finding rather than filing it at random', () => {
    render(
      <EvaluationRatings
        evaluation={evaluation({
          findings: [finding({ id: 'f9', category: 'Whimsy', summary: 'Odd metaphor.' })],
        })}
      />
    );
    expect(screen.getByText(/1 further finding/)).toBeInTheDocument();
    expect(screen.getByText('Odd metaphor.')).toBeInTheDocument();
  });

  it('is reachable through the panel the workspace actually renders', () => {
    render(
      <StageEvaluationPanel evaluation={evaluation()} />
    );
    expect(screen.getByLabelText('Drift rating')).toHaveTextContent(
      'Stays inside the objective and the approved outline.'
    );
  });
});

describe('ratingDisplay', () => {
  it('inverts drift: Low is the good end, High the bad one', () => {
    const good = ratingDisplay(evaluation({ drift_score: 'Low' })).rows.find(
      (r) => r.key === 'drift'
    )!;
    const bad = ratingDisplay(evaluation({ drift_score: 'High' })).rows.find(
      (r) => r.key === 'drift'
    )!;
    const alignedWell = ratingDisplay(evaluation({ alignment_score: 'High' })).rows.find(
      (r) => r.key === 'alignment'
    )!;

    expect(good.tone).toBe('good');
    expect(bad.tone).toBe('bad');
    expect(good.tone).toBe(alignedWell.tone);
  });

  it('omits a dimension an older evaluation never scored', () => {
    const rows = ratingDisplay(
      evaluation({ completeness_status: null, clarity_score: null as never })
    ).rows;
    expect(rows.map((r) => r.key)).toEqual(['alignment', 'drift']);
  });

  it('maps finding categories onto the dimension they speak to', () => {
    expect(findingDimension(finding({ category: 'Structure' }))).toBe('clarity');
    expect(findingDimension(finding({ category: 'Off-topic' }))).toBe('drift');
    expect(findingDimension(finding({ category: 'Coverage' }))).toBe('completeness');
    expect(findingDimension(finding({ category: 'Objective' }))).toBe('alignment');
    expect(findingDimension(finding({ category: '' }))).toBeNull();
    expect(findingDimension(finding({ category: 'Whimsy' }))).toBeNull();
  });
});
