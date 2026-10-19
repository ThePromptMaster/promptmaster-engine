/**
 * 18 Oct (Sean, Summit): "PromptMaster nevertheless retained 'EBITDA
 * deterioration despite higher revenue,' even though corrected revenue
 * declined." The figures were updated; the conclusion drawn from them was not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({ api: { dependentClaims: vi.fn() } }));

import { api } from '@/lib/api/client';
import type { ProjectFact } from '@/types/project';
import { changedFacts, claimsInstruction, claimsStillIn, dependentClaimFindings, dependentClaimsFor, STALE_CONCLUSION } from './dependent-claims';

const fact = (over: Partial<ProjectFact>): ProjectFact => ({
  id: 'f1', project_id: 'p', user_id: 'u', statement: '', subject: null, kind: 'fact', source_kind: 'chat', source_ref: {},
  accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-10-18T14:41:00Z', ...over,
});
const OLD = fact({ id: 'old', statement: 'Current-quarter revenue was $24 million.', retired_at: '2026-10-18T14:41:00Z' });
const NEW = fact({ id: 'new', statement: 'Current-quarter revenue was $22.5 million.', supersedes: 'old' });
const OTHER = fact({ id: 'o', statement: 'The board authorized the process-improvement analysis.' });
const QUOTE = 'EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap.';
const PACK = `## Supported inferences\n- **EBITDA deterioration despite higher revenue** suggests margin pressure from overtime and scrap.\n- Revenue was $22.5 million.`;

describe('a conclusion drawn from a corrected figure', () => {
  beforeEach(() => vi.mocked(api.dependentClaims).mockReset());

  it('is read against the facts that replaced something, with what each replaced', () => {
    expect(changedFacts({ facts: [OLD, NEW, OTHER] })).toEqual([{ statement: NEW.statement, replaces: OLD.statement }]);
    // Ridgeway: a correction of a figure only the brief stated has no fact to supersede, but says so.
    const ridgeway = fact({ statement: 'The CFO corrected current-quarter revenue to $27 million, superseding the earlier $30 million.' });
    expect(changedFacts({ facts: [ridgeway, OTHER] })).toEqual([{ statement: ridgeway.statement }]);
  });

  it('makes no call when no fact changed', async () => {
    expect(await dependentClaimsFor({ facts: [OTHER], model: '' }, 'Finalise', PACK)).toEqual([]);
    expect(api.dependentClaims).not.toHaveBeenCalled();
  });

  it('asks once, with the changed facts apart from the rest, and a failed check reports nothing', async () => {
    vi.mocked(api.dependentClaims).mockResolvedValueOnce({ claims: [{ quote: QUOTE, fact: NEW.statement, why: 'revenue fell' }] });
    const claims = await dependentClaimsFor({ facts: [OLD, NEW, OTHER], model: 'm' }, 'Finalise', PACK);
    expect(claims).toHaveLength(1);
    const [req] = vi.mocked(api.dependentClaims).mock.calls[0];
    expect(req.changed).toEqual([{ statement: NEW.statement, replaces: OLD.statement }]);
    expect(req.facts).toEqual([OTHER.statement]);
    vi.mocked(api.dependentClaims).mockRejectedValueOnce(new Error('down'));
    expect(await dependentClaimsFor({ facts: [OLD, NEW], model: '' }, 'Finalise', PACK)).toEqual([]);
  });

  it('is found still in a repair word for word, through Markdown, and not once rewritten', () => {
    const claim = { quote: QUOTE, fact: NEW.statement, why: 'revenue fell' };
    expect(claimsStillIn(PACK, [claim])).toEqual([claim]);
    expect(claimsStillIn('EBITDA fell while revenue also declined, to $22.5 million.', [claim])).toEqual([]);
  });

  it('is named to the repair as must-fix, and to the stage check as a finding', () => {
    const claim = { quote: QUOTE, fact: NEW.statement, why: 'revenue fell' };
    expect(claimsInstruction([claim])).toContain(`never keep it as it is: "${QUOTE}" (current fact: ${NEW.statement}; revenue fell)`);
    expect(claimsInstruction([])).toBe('');
    const [f] = dependentClaimFindings([claim]);
    expect(f.category).toBe(STALE_CONCLUSION);
    expect(f.summary).toContain(QUOTE);
  });
});
