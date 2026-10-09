import { describe, expect, it } from 'vitest';

import { needsExpert, packageMarkdown, type ExpertPackage } from './expert';

describe('the expert review package (Q3a; Sean, 9 Oct)', () => {
  it('knows a question for a specialist from a choice the user can make', () => {
    expect(needsExpert("This needs an expert's judgment: is hinge-area weighting the right discretisation?")).toBe(true);
    expect(needsExpert('Which regularisation is appropriate here needs a physicist.')).toBe(true);
    expect(needsExpert('Which amplitudes should be run?')).toBe(false);
  });

  it('reads as a document an expert can answer, with what was executed told apart', () => {
    const p: ExpertPackage = {
      question: 'Is hinge-area weighting right?',
      assumptions: [{ text: 'Piecewise flat', status: 'accepted' }, { text: 'Small deficit angles', status: 'assumed' }],
      working: [{ quote: 'deficit sum = 0.0123', source: 'Experiment', label: 'executed' }, { quote: 'S = sum A eps', source: 'Analysis', label: 'derived' }],
      evidence: ['Runs 1–3'], checks: [], unresolved: 'Which measure.', judgment_requested: 'Is the weighting correct?', depends_on_it: ['Validation'],
    };
    const md = packageMarkdown(p, 'Regge test');
    expect(md).toMatch(/^# Expert review: Regge test/);
    expect(md).toContain('- Small deficit angles (assumed, not established)');
    expect(md).toContain('— Experiment, executed — code ran');
    expect(md).toContain('— Analysis, derived — written out, not executed');
    expect(md).toContain('## Checks made or available\n- (none on record)');
    expect(md).toContain('## The judgment requested\nIs the weighting correct?');
  });
});
