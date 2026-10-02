import { describe, expect, it } from 'vitest';

import { nextStageAction, type NextActionInput } from './next-action';
import { ATTACH_DATA_LABEL, findControl, lookupLabel, stageControls, transitionEntries } from './stage-controls';
import type { TransitionOption } from './engine';

const base: NextActionInput = {
  finished: false, busy: false, dirty: false, draftable: true, hasContent: true, truncated: false,
  evaluable: true, evaluated: true, evaluationClean: true, noFurtherPassReason: null, applyableFixes: 0,
  canAdvance: false, isLast: false, nextLabel: 'Analysis', panelStep: null,
} as NextActionInput;

const options: TransitionOption[] = [
  { kind: 'advance', toStageId: 'analysis', label: 'Override and advance', requiresNote: true },
  { kind: 'skip', toStageId: 'analysis', label: 'Skip', requiresNote: true },
  { kind: 'return', toStageId: 'method', label: 'Return to Method', requiresNote: false },
];

describe('the buttons on a stage\'s page (2 Oct, item 10)', () => {
  it('lists the main button, what is under More, the open approvals and the page\'s own panels', () => {
    const primary = nextStageAction({ ...base, panelStep: { label: 'Run revision on every section', reason: '' } });
    const controls = stageControls({
      primary,
      more: [{ id: 'block', label: 'Mark as stuck…' }, { id: 'suggest', label: 'Thinking…', disabled: true }],
      options,
      nextStageLabel: 'Analysis',
      openApprovals: [{ id: 'meth.analysisplan', label: 'I approve this analysis plan for execution' }],
      lookupNoun: 'works',
      dataPanel: true,
    });
    expect(controls.map((c) => [c.label, c.place])).toEqual([
      ['Run revision on every section', 'stage_bar'],
      ['Mark as stuck…', 'more_menu'],
      ['Override and continue to Analysis', 'more_menu'],
      ['Skip this stage', 'more_menu'],
      ['Go back to Method', 'more_menu'],
      ['I approve this analysis plan for execution', 'checklist'],
      [lookupLabel('works'), 'table'],
      [ATTACH_DATA_LABEL, 'data_panel'],
    ]);
  });

  it('does not list the transition under More when it is already the main button', () => {
    const primary = nextStageAction(base);
    expect(primary.label).toBe('Override and continue to Analysis');
    expect(transitionEntries({ primary, options, nextStageLabel: 'Analysis' }).map((e) => e.id)).toEqual(['skip', 'return-method']);
    const labels = stageControls({ primary, more: [], options, nextStageLabel: 'Analysis' }).map((c) => c.label);
    expect(labels.filter((l) => l === 'Override and continue to Analysis')).toHaveLength(1);
  });

  it('lists nothing as the main button while the stage is busy or finished', () => {
    const controls = stageControls({ primary: nextStageAction({ ...base, busy: true }), more: [], options: [] });
    expect(controls).toEqual([]);
  });

  it('finds a named button only if the page has it', () => {
    const controls = stageControls({ primary: nextStageAction(base), more: [{ id: 'block', label: 'Mark as stuck…' }], options });
    expect(findControl(controls, ' mark as stuck… ')?.id).toBe('block');
    expect(findControl(controls, 'Generate the outline/results artifact')).toBeNull();
    expect(findControl(undefined, 'Mark as stuck…')).toBeNull();
  });
});
