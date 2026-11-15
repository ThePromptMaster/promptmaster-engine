// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { countTables, measure, parseRequirements, requirementsForStage } from './measurable';
import type { StageDefinition } from './types';

// Sean's inventory audit, 13 Nov: the output format he gave, word for word.
const FORMAT = 'A short table listing each error in the draft and its correction, followed by a corrected handoff the evening lead can use.';

const stage = (id: string, renderer = 'prose', label = 'Write the corrected handoff') =>
  ({ id, label, renderer, entry_prompt_hint: '', exit_criteria: [], expected_artifacts: [], transitions: {} }) as unknown as StageDefinition;

describe('a table the brief asks for is checked in code (15 Nov, inventory audit)', () => {
  it('reads "a short table" as a requirement, and not "no table" or "table of contents"', () => {
    expect(parseRequirements([FORMAT])).toEqual([expect.objectContaining({ kind: 'table', min: 1, subject: '' })]);
    expect(parseRequirements(['Write it as prose, no table.'])).toEqual([]);
    expect(parseRequirements(['Start with a table of contents.'])).toEqual([]);
    expect(parseRequirements(['Use bullets rather than a table.'])).toEqual([]);
  });

  it('holds the deliverable to it, and no other stage', () => {
    const reqs = parseRequirements([FORMAT]);
    expect(requirementsForStage(stage('handoff'), 'handoff', reqs)).toHaveLength(1);
    expect(requirementsForStage(stage('audit', 'prose', 'Audit the draft'), 'handoff', reqs)).toHaveLength(0);
    expect(requirementsForStage(stage('table', 'list', 'Build error table'), 'handoff', reqs)).toHaveLength(0);
  });

  it('fails a numbered list and passes a Markdown table', () => {
    const [req] = parseRequirements([FORMAT]);
    const list = '1. Draft: "92 kits physically on hand." Correction: 106 kits.\n2. Draft: "38 shipped." Correction: 38 shipped incl. North.';
    const table = '| Error in the draft | Correction |\n|---|---|\n| 92 kits on hand | 106 kits on hand |\n\n## Corrected handoff\n\nOn hand: 106.';
    expect(measure(req, list, true)).toEqual(expect.objectContaining({ satisfied: false, detail: 'no table' }));
    expect(measure(req, table, true)).toEqual(expect.objectContaining({ satisfied: true, value: '1 table' }));
    expect(countTables('| a | b |\n| :-- | --: |\n| 1 | 2 |')).toBe(1);
  });
});
