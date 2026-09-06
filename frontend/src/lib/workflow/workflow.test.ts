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
import type { StageContext, WorkflowEvent, WorkflowTemplate } from './types';

function emptyContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: {},
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 0,
    findingsTriaged: 0,
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
        for (const field of itemSchemaFor(stage).fields) {
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
    const r = evaluateStage(BOOK_V1, 'positioning', emptyContext({ itemCounts: { positioning: 1 } }));
    expect(r.criteria.find((c) => c.id === 'pos.comparables')!.detail).toBe('1 of 2');
  });

  it('does not treat "no sections at all" as all sections complete', () => {
    const r = evaluateStage(BOOK_V1, 'drafting', emptyContext({ sectionsTotal: 0, sectionsComplete: 0 }));
    const c = r.criteria.find((x) => x.id === 'draft.allsections')!;
    expect(c.satisfied).toBe(false);
    expect(c.detail).toBe('no sections yet');
  });

  it('passes when every section is written', () => {
    const r = evaluateStage(BOOK_V1, 'drafting', emptyContext({ sectionsTotal: 12, sectionsComplete: 12 }));
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
    expect(advance.label).toBe('Advance anyway');
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

  it('requires a note to skip', () => {
    const state = { current_stage_id: 'audience', stages: {} };
    const skip = availableTransitions(BOOK_V1, state, evaluateStage(BOOK_V1, 'audience', emptyContext())).find((t) => t.kind === 'skip')!;
    expect(skip.requiresNote).toBe(true);
  });
});

describe('projectState', () => {
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
