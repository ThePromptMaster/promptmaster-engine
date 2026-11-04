/**
 * 4 Nov (Sean, support-software memo): "B locks in $3,380, nonrefundable",
 * where only the $2,880 annual subscription was supplied as nonrefundable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({ api: { claimSupport: vi.fn(), dependentClaims: vi.fn() } }));

import { api } from '@/lib/api/client';
import type { ProjectFact } from '@/types/project';
import { claimSupportFindings, claimSupportFor, suppliedMaterial, UNSUPPORTED_CLAIM, writtenClaimFindings } from './claim-support';

const context = 'Option B:\n- $500 one-time setup fee.\n- The annual subscription payment is nonrefundable.';
const fact = (statement: string): ProjectFact => ({ id: statement, statement, kind: 'fact', source_kind: 'brief' }) as unknown as ProjectFact;
const claim = { quote: 'B locks in $3,380, nonrefundable', supplied: 'The annual subscription payment is nonrefundable.', why: 'Only the $2,880 subscription is nonrefundable.' };

describe('terms checked against what the user supplied', () => {
  beforeEach(() => {
    vi.mocked(api.claimSupport).mockReset();
    vi.mocked(api.dependentClaims).mockReset();
  });

  it('reads the request and the accepted facts', () => {
    expect(suppliedMaterial({ context, facts: [fact('Available cash is $18,000.')] })).toBe(`${context}\n\nACCEPTED FACTS:\n- Available cash is $18,000.`);
    expect(suppliedMaterial({ context: '', facts: [] })).toBe('');
  });

  it('asks nothing when nothing was supplied', async () => {
    expect(await claimSupportFor({ context: '', facts: [], model: '' }, 'Final memo', 'Text.')).toEqual([]);
    expect(api.claimSupport).not.toHaveBeenCalled();
  });

  it('a claim becomes a finding that quotes both sides and keeps the figures', async () => {
    vi.mocked(api.claimSupport).mockResolvedValue({ claims: [claim] });
    const [f] = claimSupportFindings(await claimSupportFor({ context, facts: [], model: '' }, 'Final memo', 'B locks in $3,380, nonrefundable.'));
    expect(f.category).toBe(UNSUPPORTED_CLAIM);
    expect(f.summary).toBe('"B locks in $3,380, nonrefundable" says more than the supplied facts: Only the $2,880 subscription is nonrefundable. (Supplied: "The annual subscription payment is nonrefundable.")');
    expect(f.suggested_change).toContain('Keep every figure as it is.');
    expect(claimSupportFindings([{ ...claim, supplied: '' }])[0].summary).toContain('(Nothing supplied states it.)');
  });

  it('a failed check reports nothing', async () => {
    vi.mocked(api.claimSupport).mockRejectedValue(new Error('down'));
    expect(await claimSupportFor({ context, facts: [], model: '' }, 'Final memo', 'Text.')).toEqual([]);
  });

  it('runs beside the changed-fact check on a written stage', async () => {
    vi.mocked(api.claimSupport).mockResolvedValue({ claims: [claim] });
    const findings = await writtenClaimFindings({ context, facts: [], model: '' }, 'Final memo', 'B locks in $3,380, nonrefundable.');
    expect(findings.map((f) => f.category)).toEqual([UNSUPPORTED_CLAIM]);
    // No fact replaced anything, so the changed-fact check made no call.
    expect(api.dependentClaims).not.toHaveBeenCalled();
  });
});
