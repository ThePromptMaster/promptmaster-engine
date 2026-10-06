import { describe, expect, it } from 'vitest';

import {
  BOOK_V1,
  RESEARCH_V1,
  SINGLE_OUTPUT_V1,
  WORKFLOW_TEMPLATES,
  availableTransitions,
  evaluateStage,
  getStage,
  initialState,
  nextSuggestedStage,
  progressSummary,
  projectState,
} from './index';
import { itemSchemaFor, rendererHoldsItems } from './stage-artifact';
import { validateTemplate } from './validate';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from './types';

function emptyContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: {},
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sections: {},
    findings: {},
    manualChecks: {},
    ...overrides,
  };
}

function event(
  type: WorkflowEvent['type'],
  stage_id: string,
  extra: Partial<WorkflowEvent> = {}
): WorkflowEvent {
  return { type, stage_id, actor: 'user', created_at: '2026-09-04T00:00:00Z', ...extra };
}

// --- template integrity -----------------------------------------------------
//
// These run over every template, so a future one is validated the moment it is
// added rather than the first time a user walks into a dead end.

describe.each(WORKFLOW_TEMPLATES.map((t) => [t.key, t] as const))(
  'template integrity: %s',
  (_key, template: WorkflowTemplate) => {
    const ids = new Set(template.stages.map((s) => s.id));

    it('has stages', () => {
      expect(template.stages.length).toBeGreaterThan(0);
    });

    it('passes the run-time validator a generated workflow must pass', () => {
      expect(validateTemplate(template, { requireHints: template.key !== 'single_output' })).toEqual([]);
    });

    it('has unique stage ids', () => {
      expect(ids.size).toBe(template.stages.length);
    });

    it('every default_next resolves to a real stage', () => {
      for (const stage of template.stages) {
        const next = stage.transitions.default_next;
        if (next !== null) {
          expect(ids, `${stage.id}.default_next -> ${next}`).toContain(next);
        }
      }
    });

    it('every allow_return_to target resolves to a real stage', () => {
      for (const stage of template.stages) {
        for (const target of stage.transitions.allow_return_to) {
          expect(ids, `${stage.id} returns to ${target}`).toContain(target);
        }
      }
    });

    it('ends somewhere — exactly one terminal stage', () => {
      const terminals = template.stages.filter((s) => s.transitions.default_next === null);
      expect(terminals).toHaveLength(1);
    });

    it('puts every required stage on the default path', () => {
      // A required stage a user can only reach by going backwards is a stage
      // most users will never see. Optional stages may legitimately sit off
      // the spine, reachable via a branch or a return.
      const spine = new Set<string>();
      let cursor: string | null = template.stages[0].id;
      while (cursor && !spine.has(cursor)) {
        spine.add(cursor);
        cursor = getStage(template, cursor)?.transitions.default_next ?? null;
      }
      const requiredOffSpine = template.stages
        .filter((s) => s.required && !spine.has(s.id))
        .map((s) => s.id);
      expect(requiredOffSpine).toEqual([]);
    });

    it('leaves no stage wholly unreachable', () => {
      const reachable = new Set<string>();
      const walk = (id: string) => {
        if (reachable.has(id)) return;
        reachable.add(id);
        const stage = getStage(template, id);
        if (!stage) return;
        if (stage.transitions.default_next) walk(stage.transitions.default_next);
        stage.transitions.allow_return_to.forEach(walk);
      };
      walk(template.stages[0].id);
      const orphans = template.stages.filter((s) => !reachable.has(s.id)).map((s) => s.id);
      expect(orphans).toEqual([]);
    });

    it('every skippable stage offers at least one canned reason', () => {
      // The schema makes skip-without-reason unrepresentable; the UI should
      // not leave the user to invent wording for a routine skip.
      for (const stage of template.stages) {
        if (stage.transitions.allow_skip) {
          expect(stage.skip_reasons.length, `${stage.id}`).toBeGreaterThan(0);
        }
      }
    });

    it('auto criteria carry a rule', () => {
      for (const stage of template.stages) {
        for (const c of stage.exit_criteria) {
          if (c.check === 'auto') expect(c.rule, `${stage.id}/${c.id}`).toBeDefined();
        }
      }
    });

    it('keeps mode rationales within the 80-char convention', () => {
      for (const stage of template.stages) {
        for (const m of stage.recommended_modes) {
          expect(m.reason.length, `${stage.id}/${m.mode}`).toBeLessThanOrEqual(80);
        }
      }
    });
  }
);

// --- the FR-03 claim --------------------------------------------------------

describe('FR-03: one engine, two workflows', () => {
  it('runs Book and Research through the same functions', () => {
    // Nothing below branches on which template it was handed.
    for (const template of [BOOK_V1, RESEARCH_V1]) {
      const state = initialState(template);
      expect(state.current_stage_id).toBe(template.stages[0].id);
      expect(evaluateStage(template, state.current_stage_id, emptyContext())).toBeTruthy();
      expect(availableTransitions(template, state, evaluateStage(template, state.current_stage_id, emptyContext()))).not.toHaveLength(0);
    }
  });

  it('covers both spec stage lists', () => {
    expect(BOOK_V1.stages).toHaveLength(13);
    expect(RESEARCH_V1.stages).toHaveLength(13);
  });

  it('shares renderers rather than inventing per-workflow ones', () => {
    const used = new Set(
      [...BOOK_V1.stages, ...RESEARCH_V1.stages].map((s) => s.renderer)
    );
    // Five renderers across 26 stages is the whole argument.
    expect(used.size).toBeLessThanOrEqual(5);
  });

  it("renders Book's fact-check and Research's validation with the same renderer", () => {
    // Both are "a table of items, each with a status and a reason for the
    // non-clean ones" — the sharpest evidence the engine is genuinely shared.
    expect(getStage(BOOK_V1, 'fact_check')!.renderer).toBe(
      getStage(RESEARCH_V1, 'validation')!.renderer
    );
    expect(getStage(BOOK_V1, 'fact_check')!.exit_criteria[0].rule).toEqual(
      getStage(RESEARCH_V1, 'validation')!.exit_criteria[0].rule
    );
  });

  it('expresses the two real differences as data, not code', () => {
    expect(BOOK_V1.outline_stage).toBe('explicit');
    expect(RESEARCH_V1.outline_stage).toBe('derived');

    // Book's continuity stage is the only branch in either template.
    const branching = [...BOOK_V1.stages, ...RESEARCH_V1.stages].filter(
      (s) => s.transitions.branch_options
    );
    expect(branching.map((s) => s.id)).toEqual(['continuity']);
  });

  it('reaches its terminal stage along the default path, in both workflows', () => {
    // Research differs from Book only in its data, so the same walk has to
    // arrive somewhere in both. A default_next cycle, or a spine that stops
    // short of the terminal stage, would strand a user with no way forward
    // that does not involve going backwards.
    for (const template of [BOOK_V1, RESEARCH_V1]) {
      const walked: string[] = [];
      let cursor: string | null = template.stages[0].id;
      while (cursor && !walked.includes(cursor)) {
        walked.push(cursor);
        cursor = getStage(template, cursor)!.transitions.default_next;
      }
      expect(cursor, `${template.key} loops`).toBeNull();
      const terminal = template.stages.find((s) => s.transitions.default_next === null)!;
      expect(walked.at(-1), `${template.key} spine`).toBe(terminal.id);
    }
  });

  it('walks Research to the end through the same projection Book uses', () => {
    // Not a re-read of the template: this drives projectState with a completed
    // event per stage and asserts the cursor lands on final_review.
    let events: WorkflowEvent[] = [];
    let state = initialState(RESEARCH_V1);
    while (getStage(RESEARCH_V1, state.current_stage_id)!.transitions.default_next) {
      const next = getStage(RESEARCH_V1, state.current_stage_id)!.transitions.default_next!;
      events = [...events, event('stage_completed', state.current_stage_id, { to_stage_id: next })];
      state = projectState(RESEARCH_V1, events);
    }
    expect(state.current_stage_id).toBe('final_review');
    expect(progressSummary(RESEARCH_V1, state)).toMatchObject({ complete: 12, remaining: 1 });
  });

  it('gives every long-form stage an instruction, not just guidance', () => {
    // entry_guidance is shown to the user; entry_prompt_hint is what the stage
    // generator appends to the mode-locked system prompt. A stage without one
    // generates a generic essay about its own title — which is what Research
    // v1 shipped, and what v2 exists to fix.
    for (const template of [BOOK_V1, RESEARCH_V1]) {
      for (const stage of template.stages) {
        expect(stage.entry_prompt_hint?.trim(), `${template.key}/${stage.id}`).toBeTruthy();
      }
    }
  });

  it('names a failure mode in each Research instruction, not only the output', () => {
    // The clause that does the work is the one saying what a lazy answer looks
    // like. Without it the hint is a description, and the model reliably
    // produces the thing the stage exists to prevent.
    //
    // Research only, for the same reason as the field-name contract below:
    // Book v2 is published and immutable, and its final_review hint states the
    // standard without naming what falls short of it.
    // "X rather than Y" counts — it is the same move in a positive voice.
    const NEGATIVE = /\bnot\b|\bno\b|\bnothing\b|\bnever\b|\bworse\b|\bfail|\brather than\b/i;
    for (const template of [RESEARCH_V1]) {
      for (const stage of template.stages) {
        expect(
          NEGATIVE.test(stage.entry_prompt_hint ?? ''),
          `${template.key}/${stage.id}`
        ).toBe(true);
      }
    }
  });

  it('gives every list and review stage a field schema its criteria can read', () => {
    // A stage whose artifact kind is missing from the registry falls back to
    // one free-text field: the prompt then names columns the parser drops, and
    // an every_item_has_status gate has no status enum to read, so the gate can
    // never be satisfied by any sequence of user actions. Research v1 had five
    // such stages.
    for (const template of [BOOK_V1, RESEARCH_V1]) {
      for (const stage of template.stages) {
        // Book's outline_approval renders rows but declares no artifact of its
        // own — it gates on an approval, not on something it produces.
        if (!rendererHoldsItems(stage.renderer) || !stage.expected_artifacts.length) continue;
        const schema = itemSchemaFor(stage);
        expect(
          schema.fields.map((f) => f.key),
          `${template.key}/${stage.id}`
        ).not.toEqual(['text']);
        if (stage.exit_criteria.some((c) => c.rule?.type === 'every_item_has_status')) {
          expect(schema.statuses?.length, `${template.key}/${stage.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('names the schema fields the Research hints ask the model for', () => {
    // The hint and the registry are two halves of one contract: a field named
    // in the prompt but absent from the schema is stripped by the backend
    // parser, so the column arrives empty and the stage looks broken.
    //
    // Research only. Book v2 is published and therefore immutable, and two of
    // its hints describe their rows in prose rather than naming the keys; that
    // is a v3 change, not something to relax the contract for.
    for (const template of [RESEARCH_V1]) {
      for (const stage of template.stages) {
        // Book's outline_approval renders rows but declares no artifact of its
        // own — it gates on an approval, not on something it produces.
        if (!rendererHoldsItems(stage.renderer) || !stage.expected_artifacts.length) continue;
        const hint = stage.entry_prompt_hint ?? '';
        // A field only the user fills (a DOI) is never asked of the model.
        for (const field of itemSchemaFor(stage).fields.filter((f) => !f.userOnly)) {
          expect(hint, `${template.key}/${stage.id} hint omits ${field.key}`).toContain(field.key);
        }
      }
    }
  });

  it('gives every FR-04 group a home so the rail can distinguish them', () => {
    const groups = new Set([...BOOK_V1.stages, ...RESEARCH_V1.stages].map((s) => s.group));
    for (const required of ['planning', 'outlining', 'drafting', 'expansion', 'evaluation', 'revision', 'final_review']) {
      expect(groups).toContain(required);
    }
  });
});

// --- exit criteria ----------------------------------------------------------

describe('exit criteria', () => {
  it('reads a project field', () => {
    const unmet = evaluateStage(BOOK_V1, 'objective', emptyContext());
    expect(unmet.criteria.find((c) => c.id === 'obj.stated')!.satisfied).toBe(false);

    const met = evaluateStage(BOOK_V1, 'objective', emptyContext({ fields: { objective: 'Write a book' } }));
    expect(met.criteria.find((c) => c.id === 'obj.stated')!.satisfied).toBe(true);
  });

  it('reports shortfall detail rather than just failing', () => {
    const r = evaluateStage(BOOK_V1, 'outline', emptyContext({ itemCounts: { outline: 1 } }));
    expect(r.criteria.find((c) => c.id === 'out.sections')!.detail).toBe('1 of 2');
  });

  it('does not call Revision\'s findings "applied" before anything was applied', () => {
    // all_findings_triaged counts findings on the stage itself; a long-form
    // stage has none, so it read as satisfied the moment Revision opened.
    const opened = evaluateStage(BOOK_V1, 'revision', emptyContext());
    const rule = opened.criteria.find((c) => c.id === 'rev.applied')!;
    expect(rule.satisfied).toBe(false);
    expect(rule.manual).toBe(true);
    const ticked = evaluateStage(BOOK_V1, 'revision', emptyContext({ manualChecks: { 'rev.applied': true } }));
    expect(ticked.criteria.find((c) => c.id === 'rev.applied')!.satisfied).toBe(true);
    // On a review stage it stays automatic.
    const critique = evaluateStage(BOOK_V1, 'critique', emptyContext());
    expect(critique.criteria.find((c) => c.id === 'crit.triaged')!.manual).toBeFalsy();
  });

  it('turns a count rule on a stage with nothing to count into a box the user ticks (PM-02)', () => {
    // "At least two comparables named" sits on the prose Positioning stage. A
    // prose draft has no items, so as authored this could never be satisfied —
    // this test used to hand the engine an item count the app never produces.
    const unticked = evaluateStage(BOOK_V1, 'positioning', emptyContext());
    const comparables = unticked.criteria.find((c) => c.id === 'pos.comparables')!;
    expect(comparables).toMatchObject({ manual: true, satisfied: false });

    const ticked = evaluateStage(
      BOOK_V1,
      'positioning',
      emptyContext({ manualChecks: { 'pos.comparables': true } })
    );
    expect(ticked.criteria.find((c) => c.id === 'pos.comparables')!.satisfied).toBe(true);
  });

  it('marks every criterion evaluated as manual, so the checklist can draw a box for it', () => {
    const r = evaluateStage(BOOK_V1, 'objective', emptyContext());
    const authoredManual = BOOK_V1.stages[0].exit_criteria.filter((c) => c.check === 'manual');
    for (const c of authoredManual) {
      expect(r.criteria.find((x) => x.id === c.id)!.manual).toBe(true);
    }
    expect(r.criteria.find((x) => x.id === 'obj.stated')!.manual).toBeUndefined();
  });

  it('does not treat "no sections at all" as all sections complete', () => {
    const r = evaluateStage(BOOK_V1, 'drafting', emptyContext({ sections: { drafting: { total: 0, complete: 0 } } }));
    const c = r.criteria.find((x) => x.id === 'draft.allsections')!;
    expect(c.satisfied).toBe(false);
    expect(c.detail).toBe('no sections yet');
  });

  it('passes when every section is written', () => {
    const r = evaluateStage(BOOK_V1, 'drafting', emptyContext({ sections: { drafting: { total: 12, complete: 12 } } }));
    expect(r.criteria.find((c) => c.id === 'draft.allsections')!.satisfied).toBe(true);
    expect(r.canAdvance).toBe(true);
  });

  it('requires an approved outline before drafting', () => {
    expect(evaluateStage(BOOK_V1, 'outline_approval', emptyContext()).canAdvance).toBe(false);
    expect(
      evaluateStage(BOOK_V1, 'outline_approval', emptyContext({ outlineApproved: true })).canAdvance
    ).toBe(true);
  });

  it('honours manual ticks', () => {
    const r = evaluateStage(BOOK_V1, 'editing', emptyContext({ manualChecks: { 'edit.done': true } }));
    expect(r.criteria[0].satisfied).toBe(true);
  });

  it('lets non-blocking criteria stay unmet without gating', () => {
    // "Guidance is suggestive, not restrictive."
    const r = evaluateStage(BOOK_V1, 'objective', emptyContext({ fields: { objective: 'x' } }));
    expect(r.unmet.length).toBeGreaterThan(0);
    expect(r.canAdvance).toBe(true);
  });

  it('degrades an unknown rule type to a manual check instead of throwing', () => {
    // An admin adding a criterion this build predates should get a checklist
    // item, not a broken workflow.
    const template = {
      ...SINGLE_OUTPUT_V1,
      stages: [
        {
          ...SINGLE_OUTPUT_V1.stages[0],
          exit_criteria: [
            { id: 'x', label: 'Future rule', check: 'auto' as const, rule: { type: 'invented_later' } as never },
          ],
        },
      ],
    };
    const r = evaluateStage(template, template.stages[0].id, emptyContext());
    expect(r.criteria[0].label).toMatch(/Manual check/);
    expect(r.criteria[0].satisfied).toBe(false);
  });
});

// --- transitions and projection --------------------------------------------

describe('transitions', () => {
  it('relabels advance when a blocking criterion is unmet', () => {
    const state = initialState(BOOK_V1);
    const evaluation = evaluateStage(BOOK_V1, 'objective', emptyContext());
    const advance = availableTransitions(BOOK_V1, state, evaluation).find((t) => t.kind === 'advance')!;
    expect(advance.label).toBe('Override and advance');
    expect(advance.requiresNote).toBe(true);
  });

  it('always offers advance even when blocked', () => {
    const state = initialState(BOOK_V1);
    const evaluation = evaluateStage(BOOK_V1, 'objective', emptyContext());
    expect(availableTransitions(BOOK_V1, state, evaluation).some((t) => t.kind === 'advance')).toBe(true);
  });

  it('offers finish rather than advance on the terminal stage', () => {
    const state = { current_stage_id: 'final_review', stages: {} };
    const options = availableTransitions(BOOK_V1, state, evaluateStage(BOOK_V1, 'final_review', emptyContext()));
    expect(options[0].kind).toBe('finish');
  });

  it('asks for a note to finish past an unmet blocking criterion, as advancing does', () => {
    const state = { current_stage_id: 'final_review', stages: {} };
    const blocked = { stageId: 'final_review', criteria: [], canAdvance: false, unmet: [] };
    const clear = { ...blocked, canAdvance: true };

    const finishWhenBlocked = availableTransitions(BOOK_V1, state, blocked).find((t) => t.kind === 'finish');
    expect(finishWhenBlocked).toMatchObject({ label: 'Override and finish', requiresNote: true });

    const finish = availableTransitions(BOOK_V1, state, clear).find((t) => t.kind === 'finish');
    expect(finish).toMatchObject({ label: 'Finish', requiresNote: false });
  });

  it('requires a note to skip', () => {
    const state = { current_stage_id: 'audience', stages: {} };
    const skip = availableTransitions(BOOK_V1, state, evaluateStage(BOOK_V1, 'audience', emptyContext())).find((t) => t.kind === 'skip')!;
    expect(skip.requiresNote).toBe(true);
  });
});

describe('projectState', () => {
  it('a refused revision is a record, not a move (G1)', () => {
    const before = projectState(BOOK_V1, [event('stage_completed', 'objective', { to_stage_id: 'audience' })]);
    const after = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('revision_refused', 'audience', { actor: 'system', reason: 'The revised table came back with no rows' }),
    ]);
    expect(after).toEqual(before);
  });

  it('advances the cursor on completion', () => {
    const state = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
    ]);
    expect(state.current_stage_id).toBe('audience');
    expect(state.stages.objective.status).toBe('complete');
    expect(state.stages.audience.status).toBe('in_progress');
  });

  it('records a skip with its reason', () => {
    const state = projectState(BOOK_V1, [
      event('stage_skipped', 'audience', { to_stage_id: 'positioning', reason: 'Writing for myself' }),
    ]);
    expect(state.stages.audience.status).toBe('skipped');
    expect(state.stages.audience.skipped_reason).toBe('Writing for myself');
  });

  it('marks later work stale on return rather than deleting it', () => {
    const state = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('stage_completed', 'audience', { to_stage_id: 'positioning' }),
      event('stage_returned', 'positioning', { to_stage_id: 'objective' }),
    ]);
    // The user may well keep it; it is flagged, not discarded.
    expect(state.stages.audience.status).toBe('stale');
    expect(state.current_stage_id).toBe('objective');
  });

  it('ignores content events for cursor purposes', () => {
    const state = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('outline_approved', 'outline'),
      event('section_written', 'drafting'),
    ]);
    expect(state.current_stage_id).toBe('audience');
  });

  it('is a pure projection — replaying the same events gives the same state', () => {
    const events = [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('stage_skipped', 'audience', { to_stage_id: 'positioning', reason: 'n/a' }),
    ];
    expect(projectState(BOOK_V1, events)).toEqual(projectState(BOOK_V1, events));
  });

  it('summarises progress for the rail', () => {
    const state = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('stage_skipped', 'audience', { to_stage_id: 'positioning', reason: 'n/a' }),
    ]);
    const p = progressSummary(BOOK_V1, state);
    expect(p).toMatchObject({ complete: 1, skipped: 1, total: 13 });
    expect(p.remaining).toBe(11);
  });
});

describe('nextSuggestedStage', () => {
  it('follows default_next', () => {
    expect(nextSuggestedStage(BOOK_V1, initialState(BOOK_V1))).toBe('audience');
  });

  it('falls back to the first unfinished required stage at the end', () => {
    const state = { current_stage_id: 'final_review', stages: { objective: { status: 'complete' as const } } };
    expect(nextSuggestedStage(BOOK_V1, state)).toBe('audience');
  });
});

describe('PM-13 statuses and PM-14 completion, projected from the log', () => {
  it('replays a legacy log exactly as before', () => {
    const state = projectState(BOOK_V1, [
      event('stage_completed', 'objective', { to_stage_id: 'audience' }),
      event('stage_skipped', 'audience', { to_stage_id: 'positioning', reason: 'Not needed' }),
    ]);
    expect(state.stages.objective.status).toBe('complete');
    expect(state.stages.audience.status).toBe('skipped');
    expect(state.current_stage_id).toBe('positioning');
    expect(state.project_status).toBeUndefined();
  });

  it('completion with evidence is "completed with artifact"', () => {
    const state = projectState(BOOK_V1, [
      event('stage_marked_complete', 'objective', { to_stage_id: 'audience', payload: { evidence_version_id: 'v9' } }),
    ]);
    expect(state.stages.objective).toMatchObject({ status: 'completed_with_artifact', evidence_version_id: 'v9' });
    expect(state.current_stage_id).toBe('audience');
  });

  it('moving on with requirements unmet does NOT complete the stage', () => {
    const state = projectState(BOOK_V1, [
      event('stage_advanced', 'objective', { to_stage_id: 'audience', reason: 'Will come back' }),
    ]);
    expect(state.stages.objective).toMatchObject({ status: 'in_progress', left_open: true });
    expect(state.current_stage_id).toBe('audience');
    expect(progressSummary(BOOK_V1, state).complete).toBe(0);
  });

  it('a left-open stage completed later is simply complete', () => {
    const state = projectState(BOOK_V1, [
      event('stage_advanced', 'objective', { to_stage_id: 'audience' }),
      event('stage_marked_complete', 'objective'),
    ]);
    expect(state.stages.objective).toMatchObject({ status: 'complete', left_open: false });
    expect(state.current_stage_id).toBe('audience');
  });

  it('blocked carries its kind and reason, and can be lifted', () => {
    const blocked = projectState(BOOK_V1, [
      event('stage_blocked', 'objective', { reason: 'Waiting on sales data', payload: { block_kind: 'data_missing' } }),
    ]);
    expect(blocked.stages.objective).toMatchObject({
      status: 'blocked',
      blocked: { kind: 'data_missing', reason: 'Waiting on sales data' },
    });
    const lifted = projectState(BOOK_V1, [
      event('stage_blocked', 'objective', { reason: 'x', payload: { block_kind: 'tool_missing' } }),
      event('stage_unblocked', 'objective'),
    ]);
    expect(lifted.stages.objective.status).toBe('in_progress');
    expect(lifted.stages.objective.blocked).toBeUndefined();
  });

  it('the project is finished by an event, and can be reopened', () => {
    expect(projectState(BOOK_V1, [event('project_finalized', 'final_review')]).project_status).toBe('finalized');
    expect(
      projectState(BOOK_V1, [event('project_finalized', 'final_review'), event('project_reopened', 'final_review')])
        .project_status
    ).toBe('active');
  });

  it('returning marks both kinds of completed work stale', () => {
    const state = projectState(BOOK_V1, [
      event('stage_marked_complete', 'objective', { to_stage_id: 'audience', payload: { evidence_version_id: 'v1' } }),
      event('stage_completed', 'audience', { to_stage_id: 'positioning' }),
      event('stage_returned', 'positioning', { to_stage_id: 'objective' }),
    ]);
    expect(state.stages.audience.status).toBe('stale');
    expect(state.current_stage_id).toBe('objective');
  });
});

describe('project completion is about the deliverable (PM-14)', () => {
  it('finds the deliverable: the manuscript, or the last required prose stage', async () => {
    const { deliverableStage } = await import('./engine');
    const { SINGLE_OUTPUT_V1 } = await import('./templates/single-output.v1');
    expect(deliverableStage(BOOK_V1)?.id).toBe('drafting');
    expect(deliverableStage(SINGLE_OUTPUT_V1)?.id).toBe('output');
  });

  it('a book is done when every section is written, whatever the checklists say', async () => {
    const { completionSummary } = await import('./engine');
    const state = projectState(BOOK_V1, [event('stage_advanced', 'objective', { to_stage_id: 'audience' })]);
    const done = completionSummary(BOOK_V1, state, { artifactNonEmpty: { drafting: true }, sections: { drafting: { total: 3, complete: 3 } } });
    expect(done).toMatchObject({ deliverableDone: true, leftOpen: 1 });
    const notDone = completionSummary(BOOK_V1, state, { artifactNonEmpty: { drafting: true }, sections: { drafting: { total: 3, complete: 2 } } });
    expect(notDone.deliverableDone).toBe(false);
    expect(completionSummary(BOOK_V1, state, { artifactNonEmpty: {}, sections: {} }).deliverableDone).toBe(false);
  });
});

describe('a stage left open can be closed by its own tick (A3, Sean 28 Sep item 20)', () => {
  const movedPast = [
    event('stage_marked_complete', 'objective', { to_stage_id: 'audience' }),
    event('stage_marked_complete', 'audience', { to_stage_id: 'positioning' }),
    // Positioning's required "differentiator" box is unticked: moving on is
    // "anyway", and leaves it open.
    event('stage_advanced', 'positioning', { to_stage_id: 'research' }),
  ];

  it('progressSummary reports left-open stages on their own, not as "to go"', async () => {
    const { progressSummary, leftOpenStages } = await import('./engine');
    const state = projectState(BOOK_V1, movedPast);
    expect(progressSummary(BOOK_V1, state)).toMatchObject({ complete: 2, skipped: 0, leftOpen: 1, remaining: 10 });
    expect(leftOpenStages(BOOK_V1, state).map((s) => s.id)).toEqual(['positioning']);
  });

  it('ticking the last required box closes a left-open stage', async () => {
    const { tickClosesStage } = await import('./engine');
    const state = projectState(BOOK_V1, movedPast);
    // Not yet: the required box is still unticked.
    expect(tickClosesStage(BOOK_V1, state, 'positioning', emptyContext())).toBe(false);
    // Ticking an optional box does not close it either.
    expect(tickClosesStage(BOOK_V1, state, 'positioning', emptyContext({ manualChecks: { 'pos.comparables': true } }))).toBe(false);
    // The required one does.
    expect(tickClosesStage(BOOK_V1, state, 'positioning', emptyContext({ manualChecks: { 'pos.differentiator': true } }))).toBe(true);
  });

  it('never closes a stage that is current, done, or not started', async () => {
    const { tickClosesStage } = await import('./engine');
    const state = projectState(BOOK_V1, movedPast);
    const ticked = emptyContext({ manualChecks: { 'pos.differentiator': true, 'res.openquestions': true } });
    expect(state.current_stage_id).toBe('research');
    expect(tickClosesStage(BOOK_V1, state, 'research', ticked)).toBe(false);   // current, not left open
    expect(tickClosesStage(BOOK_V1, state, 'audience', ticked)).toBe(false);   // done
    expect(tickClosesStage(BOOK_V1, state, 'outline', ticked)).toBe(false);    // not started
  });

  it('the closing event completes the stage without moving the cursor, and the count agrees', async () => {
    const { progressSummary, completionSummary } = await import('./engine');
    const state = projectState(BOOK_V1, [
      ...movedPast,
      event('stage_marked_complete', 'positioning'),
    ]);
    expect(state.current_stage_id).toBe('research');
    expect(state.stages.positioning.status).toBe('complete');
    expect(state.stages.positioning.left_open).toBe(false);
    expect(progressSummary(BOOK_V1, state)).toMatchObject({ complete: 3, leftOpen: 0, remaining: 10 });
    expect(completionSummary(BOOK_V1, state, { artifactNonEmpty: {}, sections: {} }).leftOpenStages).toEqual([]);
  });

  it('completionSummary names what is left open, so Finish can say which', async () => {
    const { completionSummary } = await import('./engine');
    const state = projectState(BOOK_V1, movedPast);
    const summary = completionSummary(BOOK_V1, state, { artifactNonEmpty: {}, sections: {} });
    expect(summary.leftOpen).toBe(1);
    expect(summary.leftOpenStages.map((s) => s.short_label)).toEqual(['Positioning']);
  });
});

describe('a done stage can be reopened and closed again (C5, Sean 28 Sep item 16)', () => {
  const twoDone = [
    event('stage_marked_complete', 'objective', { to_stage_id: 'audience', payload: { evidence_version_id: 'obj-v1' } }),
    event('stage_marked_complete', 'audience', { to_stage_id: 'positioning', payload: { evidence_version_id: 'aud-v1' } }),
  ];

  it('reopening puts the stage back in progress without moving the cursor', () => {
    const state = projectState(BOOK_V1, [...twoDone, event('stage_reopened', 'objective')]);
    expect(state.current_stage_id).toBe('positioning');
    expect(state.stages.objective).toMatchObject({ status: 'in_progress', left_open: false, evidence_version_id: 'obj-v1' });
    expect(state.stages.audience.status).toBe('completed_with_artifact');
  });

  it('closing it on the same evidence changes nothing after it', () => {
    const state = projectState(BOOK_V1, [
      ...twoDone,
      event('stage_reopened', 'objective'),
      event('stage_marked_complete', 'objective', { payload: { evidence_version_id: 'obj-v1' } }),
    ]);
    expect(state.stages.objective.status).toBe('completed_with_artifact');
    expect(state.stages.audience.status).toBe('completed_with_artifact');
  });

  it('closing it on new evidence marks the done stages after it for a recheck', () => {
    const state = projectState(BOOK_V1, [
      ...twoDone,
      event('stage_reopened', 'objective'),
      event('stage_marked_complete', 'objective', { payload: { evidence_version_id: 'obj-v2' } }),
    ]);
    expect(state.stages.objective).toMatchObject({ status: 'completed_with_artifact', evidence_version_id: 'obj-v2' });
    expect(state.stages.audience.status).toBe('stale');
    expect(state.stages.positioning.status).toBe('in_progress');
    expect(state.current_stage_id).toBe('positioning');
  });
});

describe('a left-open stage closed later on different work flags what came after (1 Oct, item 1)', () => {
  const leftWith = (version?: string) => [
    event('stage_marked_complete', 'objective', { to_stage_id: 'audience', payload: { evidence_version_id: 'obj-v1' } }),
    event('stage_marked_complete', 'audience', { to_stage_id: 'positioning', payload: { evidence_version_id: 'aud-v1' } }),
    event('stage_advanced', 'positioning', { to_stage_id: 'research', ...(version ? { payload: { left_version_id: version } } : {}) }),
    event('stage_marked_complete', 'research', { to_stage_id: 'outline', payload: { evidence_version_id: 'res-v1' } }),
  ];

  it('remembers the version the stage was left with', () => {
    const state = projectState(BOOK_V1, leftWith('pos-v1'));
    expect(state.stages.positioning).toMatchObject({ status: 'in_progress', left_open: true, left_version_id: 'pos-v1' });
  });

  it('closing it on that same version — a box ticked, nothing rewritten — flags nothing', () => {
    const state = projectState(BOOK_V1, [...leftWith('pos-v1'), event('stage_marked_complete', 'positioning', { payload: { evidence_version_id: 'pos-v1' } })]);
    expect(state.stages.positioning.status).toBe('completed_with_artifact');
    expect(state.stages.research.status).toBe('completed_with_artifact');
  });

  it('closing it on a later version marks the done stages after it for a recheck, and only those', () => {
    const state = projectState(BOOK_V1, [...leftWith('pos-v1'), event('stage_marked_complete', 'positioning', { payload: { evidence_version_id: 'pos-v2' } })]);
    expect(state.stages.research.status).toBe('stale');
    expect(state.stages.audience.status).toBe('completed_with_artifact');
    expect(state.stages.outline.status).toBe('in_progress');
    expect(state.current_stage_id).toBe('outline');
  });

  it('a log written before the version was recorded projects as it always did', () => {
    const state = projectState(BOOK_V1, [...leftWith(), event('stage_marked_complete', 'positioning', { payload: { evidence_version_id: 'pos-v2' } })]);
    expect(state.stages.research.status).toBe('completed_with_artifact');
  });
});

describe('every_item_has_status needs a drafted table (production pass, 2026-10-01)', () => {
  const stageId = BOOK_V1.stages.find((s) => s.exit_criteria.some((c) => c.rule?.type === 'every_item_has_status'))!.id;
  const ctx = (drafted: boolean, missing: number) => ({
    fields: {}, itemCounts: {}, itemsMissingStatus: { [stageId]: missing }, artifactNonEmpty: { [stageId]: drafted },
    outlineApproved: true, sections: {}, findings: {}, manualChecks: {},
  });
  const rule = (c: ReturnType<typeof ctx>) =>
    evaluateStage(BOOK_V1, stageId, c).criteria.find((r) => BOOK_V1.stages.find((s) => s.id === stageId)!.exit_criteria.find((x) => x.id === r.id)?.rule?.type === 'every_item_has_status')!;

  it('a table still being drafted is not "every row decided"', () => {
    expect(rule(ctx(false, 0))).toMatchObject({ satisfied: false, detail: 'nothing drafted yet' });
  });
  it('a drafted table with no undecided rows — or no rows at all — is', () => {
    expect(rule(ctx(true, 0)).satisfied).toBe(true);
    expect(rule(ctx(true, 2))).toMatchObject({ satisfied: false, detail: '2 still unresolved' });
  });
});

describe('every_item_has_fields: what PromptMaster can see, it verifies (1 Oct, item 6)', () => {
  const hyp = RESEARCH_V1.stages.find((s) => s.id === 'hypothesis')!;
  const ctx = (count: number, gaps: Record<string, number>, ticks: Record<string, boolean> = {}) => ({
    fields: {}, itemCounts: { hypothesis: count }, itemsMissingStatus: {}, itemFieldGaps: { hypothesis: gaps },
    artifactNonEmpty: { hypothesis: count > 0 }, outlineApproved: false, sections: {}, findings: {}, manualChecks: ticks,
  });
  const result = (c: ReturnType<typeof ctx>) => Object.fromEntries(evaluateStage(RESEARCH_V1, 'hypothesis', c).criteria.map((r) => [r.id, r]));

  it('is met when every hypothesis fills both fields, and is not a box to tick', () => {
    const r = result(ctx(3, { statement: 0, prediction: 0, disconfirming_observation: 0 }));
    expect(r['hyp.disconfirm']).toMatchObject({ satisfied: true });
    expect(r['hyp.disconfirm'].manual).toBeFalsy();
  });
  it('says how many rows fall short', () => {
    expect(result(ctx(3, { prediction: 0, disconfirming_observation: 2 }))['hyp.disconfirm']).toMatchObject({ satisfied: false, detail: '2 of 3 incomplete' });
    expect(result(ctx(0, {}))['hyp.disconfirm']).toMatchObject({ satisfied: false, detail: 'nothing to check yet' });
  });
  it('the stage still waits for the user\'s acceptance, in their own words', () => {
    const full = { prediction: 0, disconfirming_observation: 0 };
    expect(hyp.exit_criteria.find((c) => c.id === 'hyp.accept')).toMatchObject({ label: 'I accept these hypotheses as the working set', check: 'manual', blocking: true });
    expect(evaluateStage(RESEARCH_V1, 'hypothesis', ctx(1, full)).canAdvance).toBe(false);
    expect(evaluateStage(RESEARCH_V1, 'hypothesis', ctx(1, full, { 'hyp.accept': true })).canAdvance).toBe(true);
  });
});

describe('Literature counts candidates and established works separately (1 Oct, item 12)', () => {
  const ctx = (counts: Record<string, number>) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      fields: {}, itemCounts: { literature: total }, itemsMissingStatus: {}, itemStatusCounts: { literature: counts },
      artifactNonEmpty: { literature: total > 0 }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {},
    };
  };
  const result = (counts: Record<string, number>) =>
    Object.fromEntries(evaluateStage(RESEARCH_V1, 'literature', ctx(counts)).criteria.map((r) => [r.id, r]));

  it('eleven works recalled by the model are eleven candidates, and none established', () => {
    const r = result({ candidate: 11 });
    expect(r['lit.three']).toMatchObject({ label: 'At least three candidate works identified', satisfied: true });
    expect(r['lit.verified']).toMatchObject({ label: 'At least three works retrieved or verified', satisfied: false, detail: '0 of 3' });
  });
  it('retrieved and verified both count', () => {
    expect(result({ candidate: 8, verified: 2, retrieved: 1 })['lit.verified'].satisfied).toBe(true);
    expect(result({ candidate: 9, verified: 2 })['lit.verified']).toMatchObject({ satisfied: false, detail: '2 of 3' });
  });
});

describe('all_findings_triaged needs a drafted table (2 Oct, screenshot 2)', () => {
  const stageId = BOOK_V1.stages.find((s) => s.renderer === 'review' && s.exit_criteria.some((c) => c.rule?.type === 'all_findings_triaged'))!.id;
  const ctx = (drafted: boolean, total: number, triaged: number) => ({
    fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { [stageId]: drafted },
    outlineApproved: true, sections: {}, findings: { [stageId]: { total, triaged } }, manualChecks: {},
  });
  const rule = (c: ReturnType<typeof ctx>) =>
    evaluateStage(BOOK_V1, stageId, c).criteria.find((r) => BOOK_V1.stages.find((s) => s.id === stageId)!.exit_criteria.find((x) => x.id === r.id)?.rule?.type === 'all_findings_triaged')!;

  it('an undrafted review is not "every finding triaged" — it read as nothing outstanding beside a stuck card', () => {
    expect(rule(ctx(false, 0, 0))).toMatchObject({ satisfied: false, detail: 'nothing drafted yet' });
  });
  it('a drafted table with every row decided — or no rows — is', () => {
    expect(rule(ctx(true, 3, 3)).satisfied).toBe(true);
    expect(rule(ctx(true, 0, 0)).satisfied).toBe(true);
    expect(rule(ctx(true, 3, 1))).toMatchObject({ satisfied: false, detail: '2 untriaged' });
  });
});
