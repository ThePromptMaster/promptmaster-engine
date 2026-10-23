import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '@/lib/i18n/store';
import { stageText } from '@/lib/i18n/templates';
import { buildChatContext } from './chat-context';
import { initialState } from './engine';
import { stageControls } from './stage-controls';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';

/**
 * The chat and Go are told the page's buttons and stages in the words the
 * user sees (client, 21 Oct: "pick your language"): a Spanish page must not
 * have Go say "press Continue to Review".
 */
describe('the chat context in the interface language', () => {
  afterEach(() => setLocale('en'));

  it('names the buttons and stages as the page shows them', () => {
    setLocale('es');
    const T = SINGLE_OUTPUT_V1;
    const stage = T.stages[0];
    const next = T.stages[1];
    const controls = stageControls({
      primary: { kind: 'continue', label: 'unused', reason: '' },
      more: [],
      options: [{ kind: 'advance', label: 'Continue', toStageId: next.id, requiresNote: false } as never],
      nextStageLabel: stageText('es', T.key, next, 'short'),
      dataPanel: true,
    });
    const context = buildChatContext({
      template: T,
      state: initialState(T),
      project: { objective: 'x', audience: 'y', data_files: [] },
      stage,
      bundles: {},
      controls,
      display: { stageName: (s) => stageText('es', T.key, s, 'label'), workflowName: 'Resultado único' },
    });
    expect(context.stage_label).toBe('Objetivo y configuración');
    expect(context.workflow_stages).toContain('Revisar el plan');
    expect(context.buttons?.map((b) => b.label)).toContain('Adjuntar un archivo de datos');
    // The page's own data button reads the same words.
    expect(controls.find((c) => c.id === 'attach-data')?.label).toBe('Adjuntar un archivo de datos');
  });

  it('keeps the template’s own words without a display', () => {
    const T = SINGLE_OUTPUT_V1;
    const context = buildChatContext({ template: T, state: initialState(T), project: { objective: 'x', audience: 'y', data_files: [] }, stage: T.stages[0], bundles: {}, controls: null });
    expect(context.stage_label).toBe(T.stages[0].label);
  });
});
