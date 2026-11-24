import { describe, expect, it } from 'vitest';

import { blocksCompletion, describeOutstanding, outstandingWork } from '@/lib/workflow/engine';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { FolderConflict, FolderFact, ProjectFact, ProjectFolder } from '@/types/project';
import { factsToCheck, heldStages, holdsFrom, mismatchLines, mismatchOutstanding, mismatchesToRead, rulesFingerprint, rulesToReadAgainst } from './holds';
import { resolveInherited } from './inheritance';

const folder = (id: string, name: string, parent: string | null, kind: ProjectFolder['kind']): ProjectFolder => ({
  id, name, parent_id: parent, kind, user_id: 'u', position: 0, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:00:00Z',
});
const FOLDERS = [folder('acme', 'Acme', null, 'client'), folder('cfo', 'CFO search', 'acme', 'search')];
const rule = (id: string, folderId: string, statement: string, required = false): FolderFact => ({
  id, folder_id: folderId, user_id: 'u', statement, subject: null, kind: 'requirement', required, source_kind: 'typed', source_ref: {},
  origin: 'user_stated', supersedes: null, overrides: null, retired_at: null, retired_reason: null, created_at: '2026-11-24T00:00:00Z',
});
const pfact = (id: string, statement: string): ProjectFact => ({
  id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'brief', source_ref: {}, accepted_by: 'user',
  agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-11-24T01:00:00Z',
});
const event = (type: WorkflowEvent['type'], payload: Record<string, unknown>): WorkflowEvent =>
  ({ id: Math.random().toString(36), project_id: 'p', user_id: 'u', type, stage_id: 'brief', actor: 'system', payload, created_at: '2026-11-24T02:00:00Z' }) as unknown as WorkflowEvent;

const REFS = rule('refs', 'acme', 'The client handles reference checks.', true);
const NOTE = rule('note', 'cfo', 'We are handling references on this search.');
const CONFLICT: FolderConflict = {
  id: 'c1', user_id: 'u', upper_fact_id: 'refs', lower_folder_fact_id: 'note', lower_project_fact_id: null,
  upper_quote: 'client handles reference checks', lower_quote: 'We are handling references', explanation: 'Who runs references.',
  dismissed_at: null, created_at: '2026-11-24T01:00:00Z',
};
const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, NOTE], conflicts: [CONFLICT] });

describe('reading facts against the folders’ rules', () => {
  it('reads each fact once per set of rules; a new rule reads them again', () => {
    const rules = rulesToReadAgainst(inh);
    const fp = rulesFingerprint(rules);
    const facts = [pfact('a', 'Budget is $40,000.'), pfact('b', 'Start in March.')];
    expect(factsToCheck(facts, [], fp).map((f) => f.id)).toEqual(['a', 'b']);
    const read = [event('inherited_checked', { rules_fp: fp, fact_ids: ['a'] })];
    expect(factsToCheck(facts, read, fp).map((f) => f.id)).toEqual(['b']);
    const more = rulesFingerprint([...rules, { fact: rule('new', 'acme', 'Reports as PDF.') }]);
    expect(more).not.toBe(fp);
    expect(factsToCheck(facts, read, more).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('what waits on a mismatch', () => {
  it('a mismatch is read for its stages once', () => {
    expect(mismatchesToRead(inh, []).map((m) => m.conflict.id)).toEqual(['c1']);
    expect(mismatchesToRead(inh, [event('inherited_hold', { conflict_id: 'c1', stages: [] })])).toEqual([]);
  });

  it('holds the stages it names, until the user releases one or the mismatch is settled', () => {
    const events = [event('inherited_hold', { conflict_id: 'c1', stages: [{ stage_id: 'refs_plan', quote: 'Reference checks' }, { stage_id: 'report', quote: 'references' }] })];
    expect([...heldStages(inh, events).keys()]).toEqual(['refs_plan', 'report']);
    const released = [...events, event('inherited_hold', { conflict_id: 'c1', released: ['report'] })];
    expect([...heldStages(inh, released).keys()]).toEqual(['refs_plan']);
    expect(holdsFrom(released).get('c1')?.released.has('report')).toBe(true);
    const settled = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, { ...NOTE, retired_at: '2026-11-24T03:00:00Z' }], conflicts: [CONFLICT] });
    expect(heldStages(settled, events).size).toBe(0);
  });

  it('is outstanding work that holds the finish and names what it holds up', () => {
    const events = [event('inherited_hold', { conflict_id: 'c1', stages: [{ stage_id: 'refs_plan', quote: 'Reference checks' }] })];
    const items = mismatchOutstanding(inh, events, (id) => (id === 'refs_plan' ? 'Reference plan' : id));
    expect(items).toEqual([{
      conflictId: 'c1', upper: { name: 'Acme', kind: 'client' }, rule: REFS.statement, lower: { name: 'CFO search', kind: 'search' }, note: NOTE.statement, held: ['Reference plan'],
    }]);
    const out = outstandingWork({ stages: [] } as never, { stages: {} } as never, {}, { inheritedMismatches: items });
    expect(out).toHaveLength(1);
    expect(blocksCompletion(out[0])).toBe(true);
    expect(describeOutstanding(out[0])).toBe(
      'Waiting on your choice: Client “Acme” says “The client handles reference checks”, and Search “CFO search” says “We are handling references on this search”. It holds up Reference plan.'
    );
    expect(mismatchLines(items)[0]).toContain('do not draft that stage until it is chosen');
  });
});
