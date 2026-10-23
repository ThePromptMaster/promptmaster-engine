import { describe, expect, it } from 'vitest';

import { checkVerdict, formatOnly } from './check-verdict';
import { blocksCompletion, describeOutstanding, outstandingBeyondCriteria, type OutstandingItem } from './engine';
import { nextStageAction, type NextActionInput } from './next-action';
import { RESEARCH_V1 } from './templates/research.v1';
import type { StageDefinition } from './types';

const byId = (id: string) => RESEARCH_V1.stages.find((s) => s.id === id)!;
// A table stage that is not a planning one, like the custom workflow's "Known constraints and targets".
const TABLE: StageDefinition = { ...byId('literature'), group: 'drafting' };
const PROSE: StageDefinition = { ...byId('method'), group: 'drafting' };
const ev = (reason: string, over: Record<string, unknown> = {}) => ({
  version_id: 'v1',
  completeness_status: 'incomplete',
  completeness_reason: reason,
  needs_realignment: false,
  ...over,
});
// 18 Oct, Theory of Everything, prod: the reason Go would not move on.
const TOE = 'It covers the content areas but does not present them as the short table the stage asked for.';

describe('checkVerdict: one verdict for Go and for the bar (18 Oct)', () => {
  it('a table stage is not held to a layout no revision can produce', () => {
    expect(formatOnly(TABLE, TOE)).toBe(true);
    expect(checkVerdict(ev(TOE), 'v1', TABLE)).toBeNull();
  });

  it('a table stage missing content is still incomplete', () => {
    expect(checkVerdict(ev('It is missing the empirical recovery target and does not present it as a table.'), 'v1', TABLE)).toMatch(/^it is incomplete \(It is missing/);
  });

  it('a prose stage asked for a table is still incomplete', () => {
    expect(checkVerdict(ev(TOE), 'v1', PROSE)).toMatch(/incomplete/);
  });

  it('only a check of the head counts, and a planning stage is not held to completeness', () => {
    expect(checkVerdict(ev('Lacks the analysis plan.'), 'v2', PROSE)).toBeNull();
    expect(checkVerdict(ev('Lacks the analysis plan.'), 'v1', byId('method'))).toBeNull();
    expect(checkVerdict(ev('', { completeness_status: 'complete', needs_realignment: true }), 'v1', PROSE)).toBe('it needs realigning to the objective');
  });
});

describe('the bar does not say "Ready to move on" while Go will not (18 Oct)', () => {
  const base: NextActionInput = {
    finished: false, busy: false, dirty: false, draftable: true, hasContent: true, evaluable: true,
    evaluated: true, evaluationClean: false, applyableFixes: 0, canAdvance: true, isLast: false, nextLabel: 'Check targets',
  };

  it('says what the check holds, not "Everything this stage needs is done"', () => {
    const says = 'it is incomplete (It lacks the timed activities)';
    const action = nextStageAction({ ...base, checkSays: says });
    expect(action.reason).toContain(says);
    expect(action.reason).not.toMatch(/Everything this stage needs is done/);
    expect(nextStageAction(base).reason).toBe('Everything this stage needs is done.');
  });

  it('is listed as open work, on the bar itself rather than "elsewhere", and blocks nothing', () => {
    const item: OutstandingItem = { kind: 'check_says', stageId: 'targets', label: 'Targets', says: 'it is incomplete' };
    expect(describeOutstanding(item)).toBe('Targets: the latest check says it is incomplete');
    expect(outstandingBeyondCriteria([item], 'targets')).toEqual([]);
    expect(outstandingBeyondCriteria([item], 'other')).toEqual([item]);
    expect(blocksCompletion(item)).toBe(false);
  });
});

describe('a check written in another language (client, 21 Oct)', () => {
  it('reads a format-only reason in Spanish, French and German', () => {
    expect(formatOnly(TABLE, 'Los resultados no están presentados como una tabla.')).toBe(true);
    expect(formatOnly(TABLE, "Le résultat n'est pas présenté sous forme de tableau.")).toBe(true);
    expect(formatOnly(TABLE, 'Die Ergebnisse stehen nicht in einer Tabelle.')).toBe(true);
  });

  it('still holds a reason that says something is missing', () => {
    expect(formatOnly(TABLE, 'Falta el segmento de jubilados en la tabla.')).toBe(false);
    expect(formatOnly(TABLE, 'Il manque le segment des retraités dans le tableau.')).toBe(false);
    expect(formatOnly(TABLE, 'In der Tabelle fehlt das Segment der Rentner.')).toBe(false);
  });
});

