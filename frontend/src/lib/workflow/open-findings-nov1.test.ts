/**
 * 1 Nov (Sean, "Two-week early-tester recruitment plan"). After his "Change
 * it" correction, a recheck added Check finding i11 — major, and only a
 * restatement of that correction. Severity alone made it his to decide, so the
 * project stayed open on it; on Final plan Go knew "1 finding not yet accepted
 * or rejected" and nothing more, and said "I can't see the Check table from
 * this stage, so I can't tell you the finding's number or wording."
 */
import { describe, expect, it } from 'vitest';

import { buildAgentState } from '@/lib/agent/digest';
import { describeNeed } from '@/lib/agent/needs';
import { buildStageContext } from './context';
import { describeOutstanding, evaluateStage, outstandingWork, projectState } from './engine';
import { decideRow, itemSchemaFor, parseItems, serializeItems, type StageItem } from './stage-artifact';
import { BOOK_V1 } from './templates/book.v1';
import { findingRisk, quotedFact, recordedDecisions, splitUntriaged, RECORDED_REASON } from './triage';
import type { StageArtifactBundle } from './digest';
import type { Artifact, ArtifactVersion } from '@/types/project';

const T = BOOK_V1;
const critique = T.stages.find((s) => s.id === 'critique')!;
const schema = itemSchemaFor(critique);

/** The user's correction, as recorded (13:30 brief_changed, kind "fact"). */
const facts = [
  { statement: 'The total two-week marketing budget is $250, not $400.' },
  { statement: 'There are no promised tester payments.' },
  { statement: 'Honest feedback may be positive, negative or mixed.' },
];

/** Check v5 as saved at 13:58: i10 decided by Go, i11 left for the user. */
const i10: StageItem = {
  id: 'i10',
  finding: "i9's budget check, \"$300 + $100 = $400,\" tests the plan against a superseded figure.",
  why_it_matters: 'The budget area was judged against $400.',
  suggested_change: 'Treat the budget area as passing against $250.',
  severity: 'moderate',
  status: 'rejected',
  status_source: 'model',
  reason: 'Superseded.',
};
const i11: StageItem = {
  id: 'i11',
  finding: 'i2 rests on two premises that no longer hold. First, it says a session counts "only if it contains a criticism".',
  why_it_matters: 'Carrying i2 forward would reinstate payments the user removed.',
  suggested_change: "Do not carry i2's reserve or its note into the final plan. Keep C2, S4 and A3 removed and tester payments at $0.",
  severity: 'major',
  implements: 'There are no promised tester payments.',
};

function bundle(stageId: string, content: string): StageArtifactBundle {
  return { artifact: { id: `a-${stageId}`, stage_id: stageId, long_form: null } as unknown as Artifact, versions: [{ id: `v-${stageId}`, content } as ArtifactVersion] };
}
const bundles = { critique: bundle('critique', serializeItems([i10, i11])) };
const project = { objective: 'A two-week plan to recruit five early testers.', audience: '', constraints: '', manual_checks: {} };

describe('a finding that carries out the user\'s own decision is not a new decision', () => {
  it('matches the quote against the recorded facts in code', () => {
    expect(quotedFact('there are no promised  tester payments', facts)?.statement).toBe('There are no promised tester payments.');
    expect(quotedFact('Testers are paid $20 per session.', facts)).toBeNull();
    expect(quotedFact('', facts)).toBeNull();
  });

  it('i11 is routine although major, because it implements a recorded fact', () => {
    expect(findingRisk(i11, schema)).toBe('material');
    expect(findingRisk(i11, schema, facts)).toBe('routine');
    expect(splitUntriaged([i10, i11], schema, facts).routine.map((r) => r.id)).toEqual(['i11']);
  });

  it('a quote of something the user never recorded changes nothing', () => {
    expect(findingRisk({ ...i11, implements: 'Testers may be paid up to $100 in total.' }, schema, facts)).toBe('material');
  });

  it('a minor finding that alters an accepted requirement is the user\'s', () => {
    const minor: StageItem = { id: 'i14', finding: 'The cap is tight.', suggested_change: 'Raise the total to $300.', severity: 'minor', changes: 'The total two-week marketing budget is $250, not $400.' };
    expect(findingRisk(minor, schema, facts)).toBe('material');
    expect(recordedDecisions([minor], schema, facts)).toEqual([]);
  });

  it('accepts i11 in code, with the fact as its reason', () => {
    expect(recordedDecisions([i10, i11], schema, facts)).toEqual([
      { id: 'i11', status: 'accepted', reason: `${RECORDED_REASON} "There are no promised tester payments."` },
    ]);
  });
});

describe('the finding that holds the project open is named wherever it is asked about', () => {
  const context = buildStageContext({ template: T, project, bundles, events: [] });
  const state = projectState(T, [], 'final_review');
  for (const s of T.stages) if (s.id !== 'final_review') state.stages[s.id] = { ...state.stages[s.id], status: 'complete' } as never;

  it('the context carries the undecided row with its wording', () => {
    expect(context.openRows?.critique).toEqual([
      expect.objectContaining({ id: 'i11', severity: 'major', text: expect.stringContaining('i2 rests on two premises'), suggested_change: expect.stringContaining('tester payments at $0') }),
    ]);
  });

  it('the open-work line names i11, its severity, wording and suggested change', () => {
    const open = outstandingWork(T, state, context).find((o) => o.kind === 'open_findings');
    expect(open && describeOutstanding(open)).toMatch(/1 finding not yet accepted or rejected — i11 \(major\): "i2 rests on two premises.*→ suggested: "Do not carry i2's reserve/);
  });

  it('Go on the last stage is given the row, not only a count', () => {
    const stage = T.stages.find((s) => s.id === 'final_review')!;
    const digest = buildAgentState({ template: T, state, stage, bundles, steps: [], context, stageEvaluation: evaluateStage(T, stage.id, context) });
    expect(digest.open_findings_elsewhere).toEqual([
      expect.objectContaining({ stage_id: 'critique', id: 'i11', severity: 'major', text: expect.stringContaining('no longer hold') }),
    ]);
  });

  it('the stop offers Accept i11 and Reject i11 and says what each does', () => {
    const need = {
      kind: 'objective_check' as const, stageId: 'final_review', finding: 'work_open' as const,
      items: ['Critique: 1 finding not yet accepted or rejected — i11 (major): "…"'],
      rows: [{ stageId: 'critique', stageLabel: 'Critique', id: 'i11', text: 'i2 rests on two premises', severity: 'major' }],
    };
    const shown = describeNeed(need, (id: string) => (id === 'final_review' ? 'Final review' : id));
    expect(shown.options?.map((o) => o.id)).toEqual(['accept_row', 'reject_row', 'stop']);
    expect(shown.options?.[0].label).toBe('Accept i11 and carry on');
    expect(shown.message).toContain('Accepting i11 applies its suggested change and settles it on Critique');
  });

  it('deciding the row from the stop is the user\'s decision on that table', () => {
    const items = decideRow(parseItems(bundles.critique.versions[0].content)!, 'i11', 'accepted');
    expect(items.find((r) => r.id === 'i11')).toMatchObject({ status: 'accepted', status_source: 'user' });
    expect(items.find((r) => r.id === 'i10')).toEqual(i10);
  });
});
