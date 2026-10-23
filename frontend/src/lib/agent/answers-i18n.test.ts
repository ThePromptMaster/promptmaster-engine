import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { describeNeed, approvedAsItStands } from './needs';
import { answeredReturn } from './policy';

/**
 * Answers typed in Spanish, French or Portuguese are read as the English ones
 * are (client, 21 Oct: "pick your language"). Before, "Sí, hazlo" to "Shall we
 * go back to Output?" was not a yes, and "vuelve a Revisión" named no stage.
 */
const critique = BOOK_V1.stages.find((s) => s.id === 'critique')!;
const summary = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'summary')!;
const answer = (output: string) => ({ action_key: 'user_answer', status: 'succeeded', output });
const asked = {
  action_key: 'request_user_decision',
  status: 'succeeded',
  decision_question: 'Shall we go back to Output and evaluation and remove them?',
  output: '',
};

describe('a return named in another language', () => {
  it.each([
    'Vuelve a Revisión y arregla el guion primero',
    'Retourne à la Révision et corrige le scénario d’abord',
    'Volte para a Revisão e corrija o roteiro primeiro',
  ])('"%s" goes back to Revision', (text) => {
    expect(answeredReturn(BOOK_V1, critique, [answer(text)])).toMatchObject({ id: 'revision' });
  });

  it('a stage this one may not go back to is still refused', () => {
    expect(answeredReturn(BOOK_V1, critique, [answer('Vuelve a Objetivo')])).toBeNull();
  });
});

describe('a yes or a no in another language', () => {
  it.each(['Sí, hazlo', 'Oui, vas-y', 'Sim, pode', 'De acuerdo', 'd’accord'])('"%s" agrees to the return Go proposed', (text) => {
    expect(answeredReturn(SINGLE_OUTPUT_V1, summary, [asked, answer(text)])).toMatchObject({ id: 'output' });
  });

  it.each(['No, déjalo como está', 'Non, garde-le tel quel', 'Não, mantenha como está', 'Sí, pero deja las notas por ahora'])(
    '"%s" is not a go-ahead',
    (text) => {
      expect(answeredReturn(SINGLE_OUTPUT_V1, summary, [asked, answer(text)])).toBeNull();
    }
  );

  it('English reads as before', () => {
    expect(answeredReturn(SINGLE_OUTPUT_V1, summary, [asked, answer('Yes, go back and remove the revision notes')])).toMatchObject({ id: 'output' });
    expect(answeredReturn(SINGLE_OUTPUT_V1, summary, [asked, answer('No, keep the pack as it is')])).toBeNull();
    // "Simplify" starts like "sim", "nonetheless" like "non": whole words only.
    expect(answeredReturn(SINGLE_OUTPUT_V1, summary, [asked, answer('Simplify the summary instead')])).toBeNull();
  });
});

describe('"approve it as it stands" in another language', () => {
  const step = (over: Record<string, unknown>) => ({ stage_id: 'method', action_key: 'request_user_decision', output: '', changes: {}, ...over }) as never;
  it.each([
    'Aprueba el plan de análisis tal como está',
    'J’approuve le plan d’analyse tel quel',
    'Aprovo o plano de análise como está',
  ])('"%s" approves as it stands', (text) => {
    expect(approvedAsItStands([step({ action_key: 'user_answer', output: text })], 'method')).toBe(true);
  });

  it('a request for more changes does not', () => {
    expect(approvedAsItStands([step({ action_key: 'user_answer', output: 'Revisa la tabla otra vez antes de aprobar' })], 'method')).toBe(false);
  });
});

describe('the needs card in the interface language', () => {
  it('says the same need in Spanish, and English stays the sentence Go records', () => {
    const need = { kind: 'continue_budget', budgetSteps: 12 } as const;
    expect(describeNeed(need, (id) => id).message).toBe('This window of 12 steps is used up and the work is not done.');
    expect(describeNeed(need, (id) => id, {}, 'es')).toMatchObject({
      message: 'Esta ventana de 12 pasos se ha agotado y el trabajo no está terminado.',
      action: 'Continuar 12 pasos más',
    });
  });

  it('table nouns follow the language, with real plurals', () => {
    const need = { kind: 'decide_rows', stageId: 'audience', count: 3, itemLabel: 'segment' } as never;
    expect(describeNeed(need, (id) => id).message).toBe('3 segments need your decision: set a status on each in the table below.');
    expect(describeNeed(need, (id) => id, {}, 'es').message).toMatch(/^3 \S+ necesitan tu decisión/);
  });
});
