import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  api: { generateStageArtifact: vi.fn(), applyRecommendations: vi.fn() },
}));

import { api } from '@/lib/api/client';
import { carryUserFields, findingsInstruction, reviseWithFindings } from './apply-findings';
import { itemSchemaFor, parseItems, serializeItems } from './stage-artifact';
import { RESEARCH_V1 } from './templates/research.v1';

const literature = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;
const project = { objective: 'o', audience: 'a', constraints: '', mode: 'architect', model: 'm' } as never;
const findings = [{ id: 'f1', category: 'gap', summary: 'The gap is not stated', suggested_change: 'Say what is not known' }];
const rows = [
  { id: 'a', work: 'Smith 2019', finding: 'x', relation: 'y', status: 'verified', status_source: 'user', link: 'doi:10/abc' },
  { id: 'b', work: 'Lee 2021', finding: 'x', relation: 'y', status: 'candidate', status_source: 'model' },
];
const table = { stage: literature, request: (instruction: string) => ({ instruction }) as never };

describe('applying findings to a table stage (production, 2026-10-01)', () => {
  it('goes through the table generator with the findings as its instruction, never the text revision', async () => {
    vi.mocked(api.generateStageArtifact).mockResolvedValueOnce({
      content: '', finish_reason: 'stop', model_used: 'm',
      items: [{ id: 'a', work: 'Smith 2019', finding: 'x2', relation: 'y2', status: 'candidate' }, { id: 'c', work: 'New 2024', finding: 'n', relation: 'n', status: 'candidate' }],
    } as never);
    const rev = await reviseWithFindings({ project, content: serializeItems(rows), findings, source: 'the stage check', table });
    expect(api.applyRecommendations).not.toHaveBeenCalled();
    expect(vi.mocked(api.generateStageArtifact).mock.calls[0][0]).toMatchObject({ instruction: findingsInstruction(findings) });
    const after = parseItems(rev.after)!;
    expect(after).toHaveLength(2);
    // What the user set on a row survives its rewrite.
    expect(after[0]).toMatchObject({ id: 'a', finding: 'x2', status: 'verified', status_source: 'user', link: 'doi:10/abc' });
    expect(after[1]).toMatchObject({ id: 'c', status: 'candidate' });
  });

  it('refuses a result with no rows, so nothing is saved over the table', async () => {
    vi.mocked(api.generateStageArtifact).mockResolvedValueOnce({ content: 'Some prose.', items: [], finish_reason: 'stop', model_used: 'm' } as never);
    await expect(reviseWithFindings({ project, content: serializeItems(rows), findings, source: 's', table })).rejects.toThrow('came back with no rows');
  });

  it('says when the table did not come back in a usable form', async () => {
    vi.mocked(api.generateStageArtifact).mockResolvedValueOnce({ content: '', items: [], finish_reason: 'error', model_used: 'm' } as never);
    await expect(reviseWithFindings({ project, content: serializeItems(rows), findings, source: 's', table })).rejects.toThrow('usable form');
  });

  it('refuses to send a table through the text revision at all', async () => {
    await expect(reviseWithFindings({ project, content: serializeItems(rows), findings, source: 's' })).rejects.toThrow('is a table');
    expect(api.applyRecommendations).not.toHaveBeenCalled();
  });

  it('carryUserFields keeps what a lookup found when a rewrite renumbers the rows (4 Oct, production)', () => {
    const schema = itemSchemaFor(literature);
    const found = [{
      id: 'w1', work: 'Erdogmus, H. (2003). The Economics of Software Development by Pair Programmers', finding: '', relation: '',
      status: 'retrieved', status_source: 'tool', link: 'https://doi.org/10.1080/00137910309408770', record: 'The Economics… — Erdogmus (2003)',
    }];
    const rewritten = [{
      id: 'new-1', work: 'Erdogmus, H. (2003). The economics of software development by pair programmers.', finding: 'Pairs cost more per feature, fewer defects.', relation: 'Supports the question.',
      status: 'candidate',
    }];
    const [row] = carryUserFields(found, rewritten, schema);
    expect(row).toMatchObject({ status: 'retrieved', status_source: 'tool', link: 'https://doi.org/10.1080/00137910309408770', finding: 'Pairs cost more per feature, fewer defects.' });
  });

  it('carryUserFields leaves a model-set status to the new draft', () => {
    const schema = itemSchemaFor(literature);
    const out = carryUserFields(rows, [{ id: 'b', work: 'Lee 2021', finding: 'z', relation: 'z', status: 'candidate' }], schema);
    expect(out[0]).toMatchObject({ finding: 'z', status: 'candidate' });
  });
});
