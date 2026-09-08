import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EvaluationScores } from './evaluation-scores';
import type { Evaluation } from '@/types/project';

/**
 * Retiring /session deleted the pane that displayed these, and the 65 imported
 * projects carry 128 evaluation rows — 55 of those projects sit on their final
 * stage, so the scores are the main thing their owners have to look at. This
 * pins the display so a later refactor cannot quietly drop it again.
 */
function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    user_id: 'u1',
    project_id: 'p1',
    version_id: 'v1',
    alignment_score: 'High',
    alignment_explanation: '',
    drift_score: 'Low',
    drift_explanation: '',
    clarity_score: 'High',
    clarity_explanation: '',
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

describe('EvaluationScores', () => {
  it('shows all three dimensions of a stored evaluation', () => {
    render(<EvaluationScores evaluation={evaluation()} />);
    expect(screen.getByText('Alignment').parentElement).toHaveTextContent('High');
    expect(screen.getByText('Clarity').parentElement).toHaveTextContent('High');
    expect(screen.getByText('Drift').parentElement).toHaveTextContent('Low');
  });

  it('renders nothing when a version was never evaluated', () => {
    // Stage generation is one call and produces no evaluation by design, so
    // most versions have none. That must be silence, not an empty score row.
    const { container } = render(<EvaluationScores evaluation={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('treats drift as inverted: Low is the good end', () => {
    // Colouring all three by "High = good" would tell a reader their drifting
    // output was fine, which is the one thing these scores exist to prevent.
    const toneOf = (label: string, ev: Evaluation) => {
      const { container, unmount } = render(<EvaluationScores evaluation={ev} />);
      // Scope to the span for this dimension. Going via parentElement would
      // land on the whole row and always return Alignment's tone.
      const cell = [...container.querySelectorAll('span')].find((el) =>
        el.textContent?.startsWith(`${label} `)
      )!;
      const tone = cell.querySelector('.font-medium')!.className;
      unmount();
      return tone;
    };

    const goodAlignment = toneOf('Alignment', evaluation({ alignment_score: 'High' }));
    const badAlignment = toneOf('Alignment', evaluation({ alignment_score: 'Low' }));
    const goodDrift = toneOf('Drift', evaluation({ drift_score: 'Low' }));
    const badDrift = toneOf('Drift', evaluation({ drift_score: 'High' }));

    // Within a dimension, good and bad look different at all.
    expect(goodAlignment).not.toBe(badAlignment);

    // Across dimensions, the polarity is flipped: a Low drift reads the same as
    // a High alignment, and a High drift reads the same as a Low alignment.
    expect(goodDrift).toBe(goodAlignment);
    expect(badDrift).toBe(badAlignment);
  });

  it('surfaces needs_realignment, which is the whole point of scoring', () => {
    render(
      <EvaluationScores
        evaluation={evaluation({ alignment_score: 'Low', needs_realignment: true })}
      />
    );
    expect(screen.getByText('Needs realignment')).toBeInTheDocument();
  });
});
