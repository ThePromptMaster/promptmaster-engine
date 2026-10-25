/**
 * Sean, 25 Oct: the chat named buttons that were not there (and "press Resume"
 * was rewritten as "no button" although Resume was on the screen), and a
 * validation row read "Reproduced" while its text said it was not.
 */
import { describe, expect, it } from 'vitest';
import { goPanelControls, stageControls } from './stage-controls';
import { itemSchemaFor, saysNotReproduced, statusContradictsRow, type StageItem } from './stage-artifact';
import { carryUserFields } from './apply-findings';
import { RESEARCH_V1 } from './templates/research.v1';

describe('Go panel and next-step buttons are on the page list', () => {
  it('names the main button by the word it shows', () => {
    expect(goPanelControls(null).map((c) => c.label)).toEqual(['Go']);
    expect(goPanelControls({ status: 'blocked', ended_at: null, pending: false, continuable: false, asking: false })[0].label).toBe('Resume');
    expect(goPanelControls({ status: 'budget_exhausted', ended_at: 'x', pending: false, continuable: true, asking: false })[0].label).toBe('Continue');
  });

  it('adds the question card buttons while Go asks', () => {
    const labels = goPanelControls({ status: 'awaiting_decision', ended_at: null, pending: false, continuable: false, asking: true }).map((c) => c.label);
    expect(labels).toEqual(['Resume', 'Answer and continue', 'Do whatever is best']);
  });

  it('stageControls carries them with where they are', () => {
    const controls = stageControls({ more: [], options: [], nextStep: 'Apply and continue', go: goPanelControls(null) });
    expect(controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Apply and continue', place: 'next_step' }),
      expect.objectContaining({ label: 'Go', place: 'go_panel' }),
    ]));
  });
});

describe('a status the row denies', () => {
  const row = (over: Partial<StageItem>): StageItem => ({ id: 'V1', claim: 'Rényi-2 entropy scales as log L', ...over } as StageItem);

  it('reads the wordings that slipped past before', () => {
    for (const notes of ['The value has not yet been reproduced.', 'No recalculation was performed.', 'Nothing was recalculated in this round.', 'No independent reproduction exists.']) {
      expect(saysNotReproduced(row({ notes }))).toBe(true);
      expect(statusContradictsRow(row({ notes, status: 'reproduced' }))).not.toBeNull();
    }
    expect(saysNotReproduced(row({ notes: 'Reproduced from the authors’ code; matches to 3 d.p.' }))).toBe(false);
  });

  it('is not carried into a revision whose text says it was not reproduced, unless a run settled it', () => {
    const stage = RESEARCH_V1.stages.find((s) => s.expected_artifacts[0]?.kind === 'validation_table');
    expect(stage).toBeDefined();
    const schema = itemSchemaFor(stage!);
    const after = [row({ notes: 'Not reproduced: no recalculation was performed.', status: 'not_attempted' })];
    expect(carryUserFields([row({ status: 'reproduced', status_source: 'user' })], after, schema)[0].status).toBe('not_attempted');
    expect(carryUserFields([row({ status: 'reproduced' })], after, schema)[0].status).toBe('not_attempted');
    expect(carryUserFields([row({ status: 'independently_reproduced', status_source: 'sandbox' })], after, schema)[0].status).toBe('independently_reproduced');
  });
});
