import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { evaluateStage, getStage } from '@/lib/workflow/engine';
import { deriveWorkflowRecommendations } from '@/lib/workflow/recommend';
import type { StageContext, WorkflowTemplate } from '@/lib/workflow/types';
import { shownRecommendation, type RecommendationNames } from './recommend-text';
import { stageText } from './templates';

function context(template: WorkflowTemplate, done: boolean, optionalOpen = false): StageContext {
  const itemCounts: Record<string, number> = {};
  const itemsMissingStatus: Record<string, number> = {};
  const artifactNonEmpty: Record<string, boolean> = {};
  const manualChecks: Record<string, boolean> = {};
  const sections: StageContext['sections'] = {};
  const findings: StageContext['findings'] = {};
  for (const stage of template.stages) {
    itemCounts[stage.id] = done ? 99 : 0;
    itemsMissingStatus[stage.id] = 0;
    artifactNonEmpty[stage.id] = done;
    sections[stage.id] = done ? { total: 8, complete: 8 } : { total: 8, complete: 3 };
    findings[stage.id] = done ? { total: 3, triaged: 3 } : { total: 3, triaged: 0 };
    for (const c of stage.exit_criteria) manualChecks[c.id] = done && !(optionalOpen && !c.blocking);
  }
  return {
    fields: done ? { objective: 'Explain consensus.', audience: 'Engineers.', constraints: 'Short.' } : { objective: '', audience: '', constraints: '' },
    itemCounts,
    itemsMissingStatus,
    artifactNonEmpty,
    outlineApproved: done,
    sections,
    findings,
    manualChecks,
  };
}

const ELSEWHERE = ['Audience: 2 findings still open', 'Go is waiting for you: a decision from you'];

function englishNames(template: WorkflowTemplate, elsewhere: readonly string[]): RecommendationNames {
  return {
    stage: (id) => getStage(template, id)?.label ?? id,
    guidance: (id) => getStage(template, id)?.entry_guidance?.split('. ')[0] ?? '',
    elsewhere,
    templateKey: template.key,
  };
}

describe('derived suggestions on screen (client, 22 Oct: "Move on to Audience" under Español)', () => {
  // Every suggestion the builder can make, said through the keys in English,
  // reads exactly as the builder wrote it: a change to one must change the other.
  for (const template of [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1]) {
    for (const [label, ctx, elsewhere] of [
      ['nothing done', context(template, false), []],
      ['everything done', context(template, true), []],
      ['optional items open', context(template, true, true), []],
      ['work open elsewhere', context(template, true, true), ELSEWHERE],
    ] as const) {
      it(`${template.key} (${label}): the English through the keys is the builder's`, () => {
        for (const stage of template.stages) {
          const evaluation = evaluateStage(template, stage.id, ctx);
          const recs = deriveWorkflowRecommendations({ template, stage, evaluation, elsewhere: [...elsewhere] });
          for (const rec of recs) {
            expect(rec.shown, rec.category).toBeDefined();
            const said = shownRecommendation(rec, 'en', englishNames(template, elsewhere), true);
            expect(said, `${stage.id} ${rec.category}`).toEqual({ title: rec.title, summary: rec.summary, rationale: rec.rationale });
          }
        }
      });
    }
  }

  it('says "Move on to Audience" in Spanish, with the stage names translated', () => {
    const stage = BOOK_V1.stages[0];
    const evaluation = evaluateStage(BOOK_V1, stage.id, context(BOOK_V1, true, true));
    const advance = deriveWorkflowRecommendations({ template: BOOK_V1, stage, evaluation }).find((r) => r.category.startsWith('advance:'))!;
    const next = getStage(BOOK_V1, stage.transitions.default_next!)!;
    const names: RecommendationNames = {
      stage: (id) => stageText('es', 'book', getStage(BOOK_V1, id)!, 'label'),
      guidance: () => '',
      elsewhere: [],
      templateKey: 'book',
    };
    const said = shownRecommendation(advance, 'es', names);
    expect(said.title).toBe(`Pasar a ${stageText('es', 'book', next, 'label')}`);
    expect(said.summary).toContain(stageText('es', 'book', stage, 'label'));
    expect(said.summary).not.toMatch(/Nothing on|blocks moving on|optional, but worth a look/);
    // The row keeps the English it stores.
    expect(advance.title).toBe(`Move on to ${next.label}`);
  });

  it('leaves a suggestion a model wrote as it is', () => {
    const rec = { title: 'Tighten the intro', summary: 'Too long.', rationale: { triggering_issue: 'x', relevant_stage: 'y', expected_benefit: 'z', scope: 'w' } };
    expect(shownRecommendation(rec, 'es', englishNames(BOOK_V1, []))).toEqual(rec);
  });
});
