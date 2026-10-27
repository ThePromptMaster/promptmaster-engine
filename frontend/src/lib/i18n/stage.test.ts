import { afterEach, describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { EXPLORATION_V1 } from '@/lib/workflow/templates/exploration.v1';
import { ASSESSMENT_V1 } from '@/lib/workflow/templates/assessment.v1';
import { QUICK_V1 } from '@/lib/workflow/templates/quick.v1';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { operationLabel } from '@/lib/workflow/labels';
import { MODE_DISPLAY } from '@/lib/constants';
import { en } from './messages/en';
import { resetLocaleForTests, setLocale } from './store';
import { shownModeName, shownModeReason, shownOperationLabel, shownStageId } from './stage';
import { versionPillLabel } from '@/components/workflow/renderers/stage-chrome';

const SYSTEM = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, EXPLORATION_V1, ASSESSMENT_V1, QUICK_V1];

describe('the stage renderers in the interface language (client, 21 Oct)', () => {
  afterEach(() => {
    setLocale('en');
    resetLocaleForTests();
  });

  it('has every mode reason, in the template’s own English', () => {
    const dict = en as Record<string, string>;
    for (const t of SYSTEM) {
      for (const s of t.stages) {
        for (const r of s.recommended_modes) {
          expect(dict[`modeReason.${t.key}.${s.id}.${r.mode}`], `${t.key}.${s.id}.${r.mode}`).toBe(r.reason);
        }
      }
    }
    for (const [mode, d] of Object.entries(MODE_DISPLAY)) expect(dict[`mode.${mode}`], mode).toBe(d.display_name);
  });

  it('reads as before in English', () => {
    expect(shownOperationLabel('stage_draft')).toBe(operationLabel('stage_draft'));
    expect(shownOperationLabel('something_new')).toBe(operationLabel('something_new'));
    expect(shownOperationLabel(null)).toBe('Draft');
    expect(versionPillLabel({ version_number: 2, source_operation: 'agent_draft' }, true)).toBe('v2 · current · saved by Go');
    expect(shownStageId('single_output', 'fact_check')).toBe('fact check');
    expect(shownModeReason('book', 'objective', 'clarity', 'own')).toBe('own');
  });

  it('translates what made a version, the pills, mode cards and the stage badge', () => {
    setLocale('es');
    expect(shownOperationLabel('stage_draft')).toBe('Borrador de la IA');
    expect(shownOperationLabel('something_new')).toBe('Something new');
    expect(versionPillLabel({ version_number: 3, source_operation: 'stage_draft' }, false)).toBe('v3 · anterior');
    expect(versionPillLabel({ version_number: 3, source_operation: 'stage_edit' }, false)).toBe('v3 · anterior, conservada');
    expect(shownModeName('clarity', 'Clarity')).toBe('Claridad');
    expect(shownModeReason('single_output', 'input', 'clarity', 'x')).toMatch(/objetivo vago/);
    expect(shownModeReason('custom_abc', 'input', 'clarity', 'their own')).toBe('their own');
    expect(shownStageId('book', 'audience')).toBe('Público');
    expect(shownStageId('custom_abc', 'pitch_deck')).toBe('pitch deck');
  });
});
