import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { evaluateStage } from './engine';
import type { StageContext, WorkflowTemplate } from './types';
import {
  MAX_DERIVED,
  buildRationale,
  bySeverity,
  deriveWorkflowRecommendations,
  describeScope,
  isApplyable,
  kindForEvaluation,
  proposalFromCorrection,
  scopeFromModel,
  severityFor,
  signalsFromEvaluation,
  tagsFromSignals,
  type EvaluationSignals,
} from './recommend';

// --- contexts ---------------------------------------------------------------
//
// Built by running the REAL engine over two contexts rather than by fabricating
// StageEvaluation objects: the guarantee being asserted is about how
// deriveWorkflowRecommendations behaves against what evaluateStage actually
// produces, and a hand-written evaluation could satisfy the test while the
// engine produced something else.

/** Nothing done: every criterion the engine can fail, fails. */
function emptyContext(): StageContext {
  return {
    fields: { objective: '', audience: '', constraints: '' },
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 3,
    findingsTriaged: 0,
    manualChecks: {},
  };
}

/** Everything done: every criterion the engine can satisfy, satisfies. */
function satisfiedContext(template: WorkflowTemplate): StageContext {
  const itemCounts: Record<string, number> = {};
  const itemsMissingStatus: Record<string, number> = {};
  const artifactNonEmpty: Record<string, boolean> = {};
  const manualChecks: Record<string, boolean> = {};

  for (const stage of template.stages) {
    itemCounts[stage.id] = 99;
    itemsMissingStatus[stage.id] = 0;
    artifactNonEmpty[stage.id] = true;
    for (const criterion of stage.exit_criteria) manualChecks[criterion.id] = true;
  }

  return {
    fields: {
      objective: 'Explain distributed consensus to working backend engineers.',
      audience: 'Backend engineers with no formal distributed-systems training.',
      constraints: 'No vendor names. Under 40 pages.',
    },
    itemCounts,
    itemsMissingStatus,
    artifactNonEmpty,
    outlineApproved: true,
    sectionsTotal: 8,
    sectionsComplete: 8,
    findingsTotal: 3,
    findingsTriaged: 3,
    manualChecks,
  };
}

const OBJECTIVE = 'Explain distributed consensus to working backend engineers.';

// --- FR-13 ------------------------------------------------------------------

describe('FR-13: every active stage yields at least one workflow recommendation', () => {
  const templates: Array<[string, WorkflowTemplate]> = [
    ['book', BOOK_V1],
    ['research', RESEARCH_V1],
  ];

  it('BOOK_V1 and RESEARCH_V1 are the 26 stages the acceptance criterion is about', () => {
    // If this number moves, the loop below silently stops covering what it
    // claims to cover.
    expect(BOOK_V1.stages.length + RESEARCH_V1.stages.length).toBe(26);
  });

  for (const [key, template] of templates) {
    for (const stage of template.stages) {
      for (const [label, context] of [
        ['nothing done', emptyContext()],
        ['everything done', satisfiedContext(template)],
      ] as const) {
        it(`${key}/${stage.id} (${label}) yields a recommendation`, () => {
          const evaluation = evaluateStage(template, stage.id, context);
          const derived = deriveWorkflowRecommendations({
            template,
            stage,
            evaluation,
            objective: OBJECTIVE,
          });

          // The acceptance criterion, stage by stage. Rules 2 and 3 are
          // exhaustive over canAdvance, so this cannot be luck.
          expect(derived.length).toBeGreaterThanOrEqual(1);
          expect(derived.length).toBeLessThanOrEqual(MAX_DERIVED);

          for (const rec of derived) {
            // FR-14: no empty slot, on the derived half too.
            expect(rec.rationale.triggering_issue.trim()).not.toBe('');
            expect(rec.rationale.relevant_stage.trim()).not.toBe('');
            expect(rec.rationale.expected_benefit.trim()).not.toBe('');
            expect(rec.rationale.scope.trim()).not.toBe('');
            expect(rec.title.trim()).not.toBe('');
            expect(rec.summary.trim()).not.toBe('');
            expect(rec.category).toMatch(/^(setup|workflow|advance|finish):/);
            // Derived recommendations are never applyable: their affordance is
            // the checklist, the transition bar or ProjectSetup.
            expect(isApplyable(rec)).toBe(false);
          }

          // Which rule fired is determined by canAdvance, not by chance.
          const kinds = derived.map((r) => r.kind);
          if (evaluation.canAdvance) {
            expect(kinds).toContain('stage_transition');
          } else {
            expect(kinds.some((k) => k === 'workflow' || k === 'setup')).toBe(true);
          }
        });
      }
    }
  }
});

describe('FR-13: the three rules, in priority order', () => {
  const stage = BOOK_V1.stages[0];

  it('puts the setup gap first and quotes the criterion', () => {
    const evaluation = evaluateStage(BOOK_V1, stage.id, emptyContext());
    const derived = deriveWorkflowRecommendations({
      template: BOOK_V1,
      stage,
      evaluation,
      objective: '',
    });

    expect(derived[0].kind).toBe('setup');
    expect(derived[0].category).toBe(`setup:${stage.id}:objective`);
    expect(derived[0].rationale.triggering_issue).toContain(
      evaluation.criteria.find((c) => c.id === derived[0].category.split(':')[2])?.label ??
        'Objective'
    );
  });

  it('quotes an unmet blocking criterion’s detail verbatim', () => {
    // `engine.ts` writes "1 of 2"; the recommendation must not paraphrase it.
    // Book's outline stage is the one blocking `min_items` in either template
    // whose threshold is above one, so it is the only place a *partial* count
    // can be produced at all.
    const template = BOOK_V1;
    const counting = template.stages
      .flatMap((s) => s.exit_criteria.map((c) => ({ stage: s, criterion: c })))
      .find(
        ({ criterion }) =>
          criterion.blocking && criterion.rule?.type === 'min_items' && criterion.rule.n > 1
      );
    expect(counting).toBeDefined();

    const context = satisfiedContext(template);
    context.itemCounts[counting!.stage.id] = 1;
    const evaluation = evaluateStage(template, counting!.stage.id, context);
    const blocker = evaluation.unmet.find((c) => c.id === counting!.criterion.id);
    expect(blocker?.detail).toBe('1 of 2');
    // It is the one the rule will pick: the only unmet blocking criterion in a
    // context where everything else is satisfied.
    expect(evaluation.unmet.filter((c) => c.blocking).map((c) => c.id)).toEqual([
      counting!.criterion.id,
    ]);

    const derived = deriveWorkflowRecommendations({
      template,
      stage: counting!.stage,
      evaluation,
      objective: OBJECTIVE,
    });
    const workflowRec = derived.find((r) => r.kind === 'workflow');
    expect(workflowRec?.summary).toContain(blocker!.detail!);
    expect(workflowRec?.rationale.triggering_issue).toContain(blocker!.detail!);
  });

  it('offers Finish on a terminal stage rather than nothing', () => {
    const terminal = BOOK_V1.stages.find((s) => s.transitions.default_next === null);
    expect(terminal).toBeDefined();

    const evaluation = evaluateStage(BOOK_V1, terminal!.id, satisfiedContext(BOOK_V1));
    const derived = deriveWorkflowRecommendations({
      template: BOOK_V1,
      stage: terminal!,
      evaluation,
      objective: OBJECTIVE,
    });

    expect(derived.map((r) => r.title)).toContain('Finish');
    expect(derived.find((r) => r.title === 'Finish')?.category).toBe(`finish:${terminal!.id}`);
  });

  it('names the stage it advances to, on every template', () => {
    for (const template of [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1]) {
      const first = template.stages[0];
      const evaluation = evaluateStage(template, first.id, satisfiedContext(template));
      const derived = deriveWorkflowRecommendations({
        template,
        stage: first,
        evaluation,
        objective: OBJECTIVE,
      });
      const advance = derived.find((r) => r.kind === 'stage_transition');
      const next = template.stages.find((s) => s.id === first.transitions.default_next);
      expect(advance?.title).toBe(`Move on to ${next!.label}`);
    }
  });
});

describe('FR-01: a dismissal survives a refresh', () => {
  it('filters by category key, not by row id', () => {
    // Derived recommendations are recomputed each render and have no row until
    // the user acts, so a dismissal remembered by id would forget itself.
    const stage = BOOK_V1.stages[0];
    const evaluation = evaluateStage(BOOK_V1, stage.id, emptyContext());
    const all = deriveWorkflowRecommendations({
      template: BOOK_V1,
      stage,
      evaluation,
      objective: '',
    });
    expect(all.length).toBeGreaterThan(0);

    const kept = deriveWorkflowRecommendations({
      template: BOOK_V1,
      stage,
      evaluation,
      objective: '',
      dismissed: new Set([all[0].category]),
    });
    expect(kept.map((r) => r.category)).not.toContain(all[0].category);
  });
});

// --- FR-14 ------------------------------------------------------------------

const BAD: EvaluationSignals = {
  alignment: 'Low',
  clarity: 'Medium',
  drift: 'High',
  completeness: 'complete',
  needs_realignment: true,
};

describe('FR-14: no rationale slot is ever empty', () => {
  it('backfills all three optional fields when the model returned ""', () => {
    // The failure this exists to prevent: the backend schema defaults
    // triggering_issue, expected_benefit and scope to '', so a model returning
    // well-shaped JSON with nothing in it writes three blank slots into
    // `rationale` jsonb — an FR-14 failure discovered when someone opens the
    // row as evidence.
    const rationale = buildRationale(
      { triggering_issue: '', expected_benefit: '', scope: '' },
      BAD,
      { label: 'Positioning' },
      OBJECTIVE
    );

    expect(rationale.triggering_issue.trim()).not.toBe('');
    expect(rationale.relevant_stage).toBe('Positioning');
    expect(rationale.expected_benefit.trim()).not.toBe('');
    expect(rationale.scope.trim()).not.toBe('');

    // Deterministic, and in the evaluator's own terms.
    expect(rationale.triggering_issue).toContain('Drift scored High');
  });

  it('fills every slot with no model input at all, and no stage, and no objective', () => {
    const rationale = buildRationale(null, BAD, undefined, '');
    for (const value of Object.values(rationale)) {
      expect(value.trim()).not.toBe('');
    }
    expect(rationale.relevant_stage).toBe('this stage');
  });

  it('fills every slot for every combination of scores', () => {
    const scores = ['Low', 'Medium', 'High'] as const;
    for (const alignment of scores) {
      for (const clarity of scores) {
        for (const drift of scores) {
          for (const completeness of ['complete', 'incomplete', null]) {
            const rationale = buildRationale(
              { triggering_issue: '', expected_benefit: '', scope: '' },
              {
                alignment,
                clarity,
                drift,
                completeness,
                needs_realignment: alignment === 'Low' || drift === 'High',
              },
              { label: 'Drafting' },
              ''
            );
            for (const [slot, value] of Object.entries(rationale)) {
              expect(value.trim(), `${slot} empty for ${alignment}/${clarity}/${drift}`).not.toBe(
                ''
              );
            }
          }
        }
      }
    }
  });

  it('prefers the model’s words when it wrote any', () => {
    const rationale = buildRationale(
      {
        triggering_issue: 'Chapter three argues for a position the introduction ruled out.',
        expected_benefit: 'The argument stops contradicting itself.',
        scope: 'Chapter three only.',
      },
      BAD,
      { label: 'Drafting' },
      OBJECTIVE
    );
    expect(rationale.triggering_issue).toBe(
      'Chapter three argues for a position the introduction ruled out.'
    );
    expect(rationale.scope).toBe('Chapter three only.');
  });

  it('carries the evaluator’s explanation into the backfill when there is one', () => {
    const rationale = buildRationale(null, { ...BAD, drift_explanation: 'It reviews the field instead of arguing.' }, { label: 'Drafting' }, '');
    expect(rationale.triggering_issue).toContain('It reviews the field instead of arguing.');
  });
});

// --- severity and kind ------------------------------------------------------

describe('severity is derived purely from scores', () => {
  const base: EvaluationSignals = {
    alignment: 'High',
    clarity: 'High',
    drift: 'Low',
    completeness: 'complete',
    needs_realignment: false,
  };

  it('blocking requires incomplete AND alignment Low', () => {
    expect(severityFor({ ...base, completeness: 'incomplete', alignment: 'Low' })).toBe('blocking');
    // Either one alone is not blocking — an incomplete but well-aimed draft is
    // worth finishing, not worth stopping the project for.
    expect(severityFor({ ...base, completeness: 'incomplete' })).toBe('info');
    expect(severityFor({ ...base, alignment: 'Low' })).toBe('major');
  });

  it('major is alignment Low or drift High', () => {
    expect(severityFor({ ...base, alignment: 'Low' })).toBe('major');
    expect(severityFor({ ...base, drift: 'High' })).toBe('major');
  });

  it('minor is any Medium, or clarity Low', () => {
    expect(severityFor({ ...base, alignment: 'Medium' })).toBe('minor');
    expect(severityFor({ ...base, clarity: 'Medium' })).toBe('minor');
    expect(severityFor({ ...base, drift: 'Medium' })).toBe('minor');
    expect(severityFor({ ...base, clarity: 'Low' })).toBe('minor');
  });

  it('info is everything else — drift Low is good, not bad', () => {
    expect(severityFor(base)).toBe('info');
    expect(severityFor({ ...base, drift: 'Low' })).toBe('info');
  });

  it('sorts worst first', () => {
    const rows = [
      { severity: 'info' as const },
      { severity: 'blocking' as const },
      { severity: 'minor' as const },
      { severity: 'major' as const },
    ];
    expect([...rows].sort(bySeverity).map((r) => r.severity)).toEqual([
      'blocking',
      'major',
      'minor',
      'info',
    ]);
  });
});

describe('kind maps onto the closed CHECK constraint', () => {
  it('drift High or needs_realignment gives realignment; otherwise fix', () => {
    expect(kindForEvaluation({ ...BAD, drift: 'High' })).toBe('realignment');
    expect(
      kindForEvaluation({
        alignment: 'Medium',
        clarity: 'Medium',
        drift: 'Low',
        completeness: 'complete',
        needs_realignment: false,
      })
    ).toBe('fix');
  });

  it('reads needs_realignment rather than re-deriving it', () => {
    // The evaluation system says needs_realignment is the single authority.
    const signals = signalsFromEvaluation({
      alignment_score: 'Low',
      clarity_score: 'High',
      drift_score: 'Low',
      needs_realignment: true,
    });
    expect(signals.needs_realignment).toBe(true);
    expect(kindForEvaluation(signals)).toBe('realignment');
  });

  it('re-derives it only for a shape that never computed one', () => {
    const signals = signalsFromEvaluation({
      alignment_score: 'Low',
      clarity_score: 'High',
      drift_score: 'Low',
    });
    expect(signals.needs_realignment).toBe(true);
  });
});

// --- scope ------------------------------------------------------------------

describe('scope is structured, and no anchor is inferred from prose', () => {
  it('keeps the model’s sentence but stays a document scope', () => {
    // A wrong anchor silently rewrites the wrong paragraph, which the user
    // cannot see happen. Coarse and visible beats precise and wrong.
    const scope = scopeFromModel('The second paragraph of chapter three.', 'Drafting');
    expect(scope.kind).toBe('document');
    expect(scope.described_as).toBe('The second paragraph of chapter three.');
    expect(scope.section_id).toBeUndefined();
    expect(scope.selection).toBeUndefined();
  });

  it('never leaves described_as empty', () => {
    expect(scopeFromModel('', 'Drafting').described_as).toContain('Drafting');
    expect(scopeFromModel(undefined, 'Drafting').described_as).toContain('Drafting');
  });

  it('describes each scope kind for the apply preview', () => {
    expect(describeScope({ kind: 'document', described_as: 'x' })).toBe('The whole document');
    expect(describeScope({ kind: 'section', described_as: 'x', section_id: 's2' })).toContain('s2');
    expect(
      describeScope({ kind: 'selection', described_as: 'x', selection: { start: 10, end: 40 } })
    ).toContain('10');
  });
});

// --- the model's correction -------------------------------------------------

describe('an evaluator correction becomes a row-shaped proposal', () => {
  const correction = {
    id: 'r1',
    title: 'Cut the vendor comparison',
    triggering_issue: 'The constraints forbid naming vendors.',
    expected_benefit: '',
    scope: '',
    instruction: 'Remove every named vendor and restate the comparison in generic terms.',
  };

  it('is applyable, tagged, and fully rationalised', () => {
    const proposal = proposalFromCorrection(
      correction,
      BAD,
      BOOK_V1.stages[0],
      OBJECTIVE
    );

    expect(proposal.kind).toBe('realignment');
    expect(proposal.severity).toBe('major');
    expect(isApplyable(proposal)).toBe(true);
    expect(proposal.instruction).toBe(correction.instruction);
    expect(proposal.tags.length).toBeGreaterThan(0);
    for (const value of Object.values(proposal.rationale)) expect(value.trim()).not.toBe('');
    expect(proposal.category).toBe(`evaluation:${BOOK_V1.stages[0].id}:r1`);
  });

  it('carries no tags when there is nothing to apply', () => {
    // Untagged means uncombinable, which is correct: FR-15 combines revision
    // instructions, and there is no revision instruction here.
    const proposal = proposalFromCorrection(
      { ...correction, instruction: '   ' },
      BAD,
      BOOK_V1.stages[0],
      OBJECTIVE
    );
    expect(isApplyable(proposal)).toBe(false);
    expect(proposal.tags).toEqual([]);
  });

  it('tags deterministically from the scores', () => {
    expect(tagsFromSignals(BAD)).toEqual(tagsFromSignals(BAD));
    expect(tagsFromSignals({ ...BAD, completeness: 'incomplete' })).toContain('length:longer');
    expect(
      tagsFromSignals({
        alignment: 'High',
        clarity: 'Low',
        drift: 'Low',
        completeness: 'complete',
        needs_realignment: false,
      })
    ).toContain('structure:more');
  });
});
