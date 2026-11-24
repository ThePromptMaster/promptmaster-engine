import { describe, expect, it } from 'vitest';

import { templateFromDesign } from '@/lib/workflow/custom';
import { validateTemplate } from '@/lib/workflow/validate';
import { masterChanges, withStageEdit } from '@/lib/folders/template-lineage';
import { linkQuotes, sourceDocs } from '@/lib/evidence/quote-links';
import { ENGAGEMENT_TERMS, MASTER_V2_REVIEW_INSTRUCTION, POSITION_SPEC, SAMPLE_NAMES, SAMPLE_RULES, SAMPLE_TRANSCRIPT, TRANSCRIPT_REVIEW } from './search-firm';

describe('the sample search-firm workspace', () => {
  it('is plainly a sample, with invented names', () => {
    expect(SAMPLE_NAMES.workspace).toMatch(/\(sample\)/);
    expect(SAMPLE_NAMES.client).toMatch(/\(sample client\)/);
    for (const text of [ENGAGEMENT_TERMS, POSITION_SPEC, SAMPLE_TRANSCRIPT]) expect(text).toMatch(/invented/i);
  });

  it('its transcript-review workflow is valid, and the master’s second version changes one instruction', () => {
    const master = templateFromDesign(TRANSCRIPT_REVIEW, 'test');
    expect(validateTemplate(master)).toEqual([]);
    const v2 = withStageEdit(master, master.stages[1].id, { entry_prompt_hint: MASTER_V2_REVIEW_INSTRUCTION });
    expect(masterChanges(master, v2).map((c) => [c.label, c.fields.map((f) => f.field)])).toEqual([['Transcript review', ['entry_prompt_hint']]]);
  });

  it('the material sets up the case: the client rule and the search note disagree, and the spec asks what the interview left out', () => {
    expect(SAMPLE_RULES.clientRequired).toMatch(/HR team runs all reference checks/);
    expect(SAMPLE_RULES.searchNote).toMatch(/We run the reference checks/);
    expect(POSITION_SPEC).toMatch(/willingness to relocate to Cork/);
    expect(SAMPLE_TRANSCRIPT).not.toMatch(/relocat/i);
  });

  it('a quote of the candidate is found in the transcript as the project holds it', () => {
    const docs = sourceDocs(`### From Interview transcript.txt\n\n${SAMPLE_TRANSCRIPT}`);
    const [link] = linkQuotes(['We went live two months late, because the inventory data was in worse shape than anyone admitted'], docs);
    expect(link.doc.name).toBe('Interview transcript.txt');
  });
});
