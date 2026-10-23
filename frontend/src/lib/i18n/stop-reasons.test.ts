import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NEED_CLEARED, NEED_MOVED_ON } from '@/lib/agent/needs';
import { preempt } from '@/lib/agent/policy';
import { en as stopEn } from './messages/areas/stop';
import { shownGoWaiting, shownStopReason } from './stop-reasons';

/** Where Go writes its stop reasons in code. */
const SOURCES = [
  'src/components/workflow/use-go-loop.ts',
  'src/lib/agent/policy.ts',
  'src/lib/agent/round-close.ts',
  'src/lib/agent/needs.ts',
  'src/lib/workflow/objective.ts',
  'src/components/workflow/workflow-workspace.tsx',
]
  .map((p) => readFileSync(join(process.cwd(), p), 'utf8'))
  .join('\n')
  // A sentence split over lines (`'…, ' +\n '…'`) reads as one.
  .replace(/[`'"]\s*\+\s*\n\s*[`'"]/g, '');

describe('stop reasons on screen (client, 21 Oct: "pick your language")', () => {
  it('each recognised English reason is still written by Go: a change there must change the map', () => {
    for (const [key, english] of Object.entries(stopEn)) {
      // The literal runs between placeholders, clause by clause: the code
      // builds some reasons from parts ("…, and ${result}.").
      const pieces = english
        .split(/\{\w+\}|, and |\. /)
        .map((p) => p.trim().replace(/\.$/, ''))
        .filter((p) => p.length >= 12);
      for (const piece of pieces) {
        const inCode = SOURCES.includes(piece) || SOURCES.includes(piece.replace(/"/g, '\\"'));
        expect(inCode, `${key}: "${piece}"`).toBe(true);
      }
    }
    expect(NEED_CLEARED).toBe(stopEn['stop.cleared']);
    expect(NEED_MOVED_ON).toBe(stopEn['stop.movedOn']);
  });

  it('shows a code-written reason in the interface language, with its parts filled in', () => {
    expect(shownStopReason('es', 'Stopped by you.')).toBe('Detenido por ti.');
    expect(shownStopReason('fr', NEED_CLEARED)).toBe('Prêt à continuer — appuyez sur Reprendre.');
    expect(shownStopReason('pt', "Used all 12 steps of this run's budget.")).toBe('Os 12 passos do orçamento desta execução foram usados.');
    expect(shownStopReason('es', 'This stage is marked stuck: no data yet. Clear that, or skip it, to let Go continue.')).toBe(
      'Esta etapa está marcada como atascada: no data yet. Resuélvelo u omítela para que Go continúe.'
    );
  });

  it('reads what preempt writes', () => {
    const state = { project_status: 'finalized', stages: {}, current_stage_id: 'x' } as never;
    const reason = preempt({ state, objective: 'x', stepsUsed: 0, budgetSteps: 10, steps: [] })!.reason;
    expect(shownStopReason('es', reason)).toBe('El proyecto está terminado.');
  });

  it('leaves English, the model\'s own questions and unknown text as written', () => {
    expect(shownStopReason('en', 'Stopped by you.')).toBe('Stopped by you.');
    expect(shownStopReason('es', 'Which of the two cities should the memo cover?')).toBe('Which of the two cities should the memo cover?');
    expect(shownStopReason('es', null)).toBeNull();
  });

  it('says what Go waits for in the outstanding list', () => {
    expect(shownGoWaiting('es', 'a decision from you')).toBe('una decisión tuya');
    expect(shownGoWaiting('fr', 'resume Go to check the objective again')).toBe('relancez Go pour vérifier à nouveau l’objectif');
    expect(shownGoWaiting('en', 'a decision from you')).toBe('a decision from you');
  });
});
