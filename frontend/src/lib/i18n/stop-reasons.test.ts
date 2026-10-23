import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { describeNeed, NEED_CLEARED, NEED_MOVED_ON, type NeedsUser } from '@/lib/agent/needs';
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

describe("Go's request, as its stop reason recorded it (client, 22 Oct, Research project)", () => {
  const stageLabel = (id: string) => ({ method: 'Method', question: 'Question', literature: 'Literature' })[id] ?? id;
  const shownLabel = (id: string) => ({ method: 'Método', question: 'Pregunta', literature: 'Bibliografía' })[id] ?? id;
  const byEnglish = (en: string) => ({ Method: 'Método', Question: 'Pregunta', Literature: 'Bibliografía' })[en] ?? en;

  const needs: NeedsUser[] = [
    {
      kind: 'tick_criterion', stageId: 'method', criterionId: 'meth.analysisplan', authority: 'reserved',
      label: 'I approve this analysis plan for execution',
      hint: 'Fixed now, before anything runs, so the data cannot choose the analysis.',
    },
    { kind: 'tick_criterion', stageId: 'method', criterionId: 'x', label: 'I approve this analysis plan for execution', authority: 'policy_ask' },
    { kind: 'tick_criterion', stageId: 'method', criterionId: 'x', label: 'I approve this analysis plan for execution' },
    { kind: 'set_objective' },
    { kind: 'approve_outline', stageId: 'question', versionNumber: 3, unsavedDraft: false },
    { kind: 'approve_outline', stageId: 'question', versionNumber: null, unsavedDraft: true },
    { kind: 'skip_stage', stageId: 'literature', reason: 'The question needs no prior work.' },
    { kind: 'wait_for_jobs', stageId: 'question', pending: 2, complete: 3, total: 5 },
    { kind: 'continue_budget', budgetSteps: 12 },
    { kind: 'large_job', stageId: 'question', sections: 14 },
    { kind: 'triage_findings', stageId: 'question', count: 1 },
    { kind: 'triage_findings', stageId: 'question', count: 4 },
  ];

  it('each recorded request reads as the card says it in Spanish', () => {
    for (const need of needs) {
      const recorded = describeNeed(need, stageLabel).message;
      const card = describeNeed(need, shownLabel, {}, 'es').message;
      expect(shownStopReason('es', recorded, byEnglish), recorded).toBe(card);
      // English is left exactly as Go wrote it.
      expect(shownStopReason('en', recorded, byEnglish)).toBe(recorded);
    }
  });

  it('the outstanding line says Go waits in the interface language', () => {
    const recorded = describeNeed(needs[0], stageLabel).message;
    const shown = shownGoWaiting('es', recorded, byEnglish)!;
    expect(shown).not.toMatch(/Needs your approval|yours alone|Fixed now/);
    expect(shown).toBe(describeNeed(needs[0], shownLabel, {}, 'es').message);
  });
});
