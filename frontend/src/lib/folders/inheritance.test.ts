import { describe, expect, it } from 'vitest';

import { factsForRequest, factCitedAs } from '@/lib/workflow/facts';
import {
  folderChain,
  inheritedCounts,
  inheritedForRequest,
  materialWithInherited,
  MAX_INHERITED_SENT,
  projectReplacements,
  resolveInherited,
} from './inheritance';
import type { FolderDocument, FolderFact, ProjectFact, ProjectFolder } from '@/types/project';

/**
 * Sean, 23 Nov: "one workspace, one client, and two searches. Give the client a
 * reference-handling default, make an exception in one search, and confirm the
 * other search still follows the default."
 */
const folder = (id: string, name: string, parent: string | null, kind: ProjectFolder['kind']): ProjectFolder => ({
  id, name, parent_id: parent, kind, user_id: 'u', position: 0, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:00:00Z',
});
const FOLDERS = [
  folder('ws', 'Northgate', null, 'workspace'),
  folder('acme', 'Acme', 'ws', 'client'),
  folder('cfo', 'CFO search', 'acme', 'search'),
  folder('vp', 'VP Ops search', 'acme', 'search'),
  folder('interviews', 'Interviews', 'cfo', 'folder'),
];

let n = 0;
const rule = (id: string, folderId: string, statement: string, extra: Partial<FolderFact> = {}): FolderFact => ({
  id, folder_id: folderId, user_id: 'u', statement, subject: null, kind: 'requirement', required: false, source_kind: 'typed',
  source_ref: {}, origin: 'user_stated', supersedes: null, overrides: null, retired_at: null, retired_reason: null,
  created_at: `2026-11-24T00:00:${String(n++).padStart(2, '0')}Z`, ...extra,
});
const pfact = (id: string, statement: string, extra: Partial<ProjectFact> = {}): ProjectFact => ({
  id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'brief', source_ref: {},
  accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null,
  created_at: '2026-11-24T01:00:00Z', ...extra,
});

const STYLE = rule('style', 'ws', 'Candidate reports use the firm template.');
const REFS = rule('refs', 'acme', 'The client handles reference checks.');
const FORMAT = rule('format', 'acme', 'Reports go to the client as PDF.', { required: true });
const SPEC = rule('spec', 'cfo', 'The CFO must have led an IPO.');

describe('folderChain', () => {
  it('runs from the top down to the folder', () => {
    expect(folderChain(FOLDERS, 'interviews').map((l) => [l.name, l.depth])).toEqual([
      ['Northgate', 0], ['Acme', 1], ['CFO search', 2], ['Interviews', 3],
    ]);
  });
  it('is empty for Unfiled and for a folder that is gone', () => {
    expect(folderChain(FOLDERS, null)).toEqual([]);
    expect(folderChain(FOLDERS, 'missing')).toEqual([]);
  });
});

describe('resolveInherited: the client default, two searches', () => {
  const facts = [STYLE, REFS, FORMAT, SPEC];

  it('hands every folder rule down, top first, with where it came from', () => {
    const inh = resolveInherited({ folders: FOLDERS, folderId: 'interviews', facts });
    expect(inh.inForce.map((r) => [r.fact.id, r.level.name])).toEqual([
      ['style', 'Northgate'], ['refs', 'Acme'], ['format', 'Acme'], ['spec', 'CFO search'],
    ]);
  });

  it('keeps one search rule out of the other search', () => {
    const vp = resolveInherited({ folders: FOLDERS, folderId: 'vp', facts });
    expect(vp.inForce.map((r) => r.fact.id)).toEqual(['style', 'refs', 'format']);
  });

  it('a replacement in one search leaves the other search, and a new one, on the client default', () => {
    const ours = rule('ours', 'cfo', 'We handle reference checks on this search.', { overrides: 'refs' });
    const withIt = [...facts, ours];
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'interviews', facts: withIt });
    expect(cfo.inForce.map((r) => r.fact.id)).not.toContain('refs');
    expect(cfo.inForce.map((r) => r.fact.id)).toContain('ours');
    expect(cfo.rules.find((r) => r.fact.id === 'refs')?.replacedBy).toMatchObject({ id: 'ours', at: { name: 'CFO search' } });

    const vp = resolveInherited({ folders: [...FOLDERS], folderId: 'vp', facts: withIt });
    expect(vp.inForce.map((r) => r.fact.id)).toContain('refs');
    expect(vp.inForce.map((r) => r.fact.id)).not.toContain('ours');

    const later = resolveInherited({ folders: [...FOLDERS, folder('cto', 'CTO search', 'acme', 'search')], folderId: 'cto', facts: withIt });
    expect(later.inForce.map((r) => r.fact.id)).toContain('refs');
  });

  it('saying something different without pointing at the default replaces nothing', () => {
    const note = rule('note', 'cfo', 'We are handling references on this search.');
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [...facts, note] });
    expect(cfo.inForce.map((r) => r.fact.id)).toEqual(expect.arrayContaining(['refs', 'note']));
  });

  it('never lets a required rule be replaced', () => {
    const pdf = rule('word', 'cfo', 'Reports go as Word files.', { overrides: 'format' });
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [...facts, pdf] });
    expect(cfo.inForce.map((r) => r.fact.id)).toContain('format');
    expect(cfo.ignored).toEqual([expect.objectContaining({ id: 'word', why: 'now_required' })]);
  });

  it('a replacement stops counting when the default it replaced becomes required', () => {
    const ours = rule('ours', 'cfo', 'We handle references.', { overrides: 'refs' });
    const retired = { ...REFS, retired_at: '2026-11-24T02:00:00Z', retired_reason: 'superseded' };
    const nowRequired = rule('refs2', 'acme', 'The client handles reference checks.', { supersedes: 'refs', required: true });
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [STYLE, retired, nowRequired, ours] });
    expect(cfo.inForce.map((r) => r.fact.id)).toContain('refs2');
    expect(cfo.ignored.map((i) => i.why)).toEqual(['now_required']);
  });

  it('follows a corrected default forward and says it changed', () => {
    const ours = rule('ours', 'cfo', 'We handle references.', { overrides: 'refs' });
    const retired = { ...REFS, retired_at: '2026-11-24T02:00:00Z', retired_reason: 'superseded' };
    const corrected = rule('refs2', 'acme', 'The client handles references and backchannels.', { supersedes: 'refs' });
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [retired, corrected, ours] });
    expect(cfo.rules.find((r) => r.fact.id === 'refs2')?.replacedBy).toMatchObject({ id: 'ours', defaultChanged: true });
  });

  it('a pointer made in a folder outside the chain does nothing', () => {
    const elsewhere = rule('vpOwn', 'vp', 'The VP search handles references itself.', { overrides: 'refs' });
    const cfo = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [...facts, elsewhere] });
    expect(cfo.inForce.map((r) => r.fact.id)).toContain('refs');
    expect(cfo.rules.map((r) => r.fact.id)).not.toContain('vpOwn');
  });

  it('a project fact replaces a default for that project only', () => {
    const own = pfact('pf', 'For this candidate we take references ourselves.', { overrides_folder_fact: 'refs' });
    const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts, projectFacts: [own] });
    expect(inh.inForce.map((r) => r.fact.id)).not.toContain('refs');
    expect(projectReplacements(inh).get('pf')?.fact.id).toBe('refs');
    expect(inheritedCounts(inh).differentHere).toBe(1);
  });

  it('a retired rule is not handed down', () => {
    const gone = { ...SPEC, retired_at: '2026-11-24T03:00:00Z', retired_reason: 'taken out by the user' };
    expect(resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, gone] }).inForce.map((r) => r.fact.id)).toEqual(['refs']);
  });
});

describe('what a request carries', () => {
  const doc = (id: string, folderId: string, name: string, text: string): FolderDocument => ({
    id, folder_id: folderId, user_id: 'u', name, text, source_ref: {}, retired_at: null, retired_reason: null, created_at: '2026-11-24T00:00:00Z',
  });

  it('sends required rules first, each naming its folder', () => {
    const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [STYLE, REFS, FORMAT, SPEC] });
    const { facts } = inheritedForRequest(inh);
    expect(facts[0]).toMatchObject({ statement: 'Reports go to the client as PDF.', required: true, scope: 'the client folder "Acme"' });
    expect(facts.map((f) => f.scope)).toContain('the workspace "Northgate"');
    expect(facts.find((f) => f.statement.startsWith('The CFO'))?.source).toMatch(/^from the search folder "CFO search"/);
  });

  it('a folder replacement says what default it replaces', () => {
    const ours = rule('ours', 'cfo', 'We handle reference checks on this search.', { overrides: 'refs' });
    const { facts } = inheritedForRequest(resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, ours] }));
    expect(facts).toEqual([expect.objectContaining({ statement: ours.statement, replaces_default: 'The client handles reference checks. (the default of the client folder "Acme")' })]);
  });

  it('keeps the project facts first, so a conflict check numbers them the same', () => {
    const own = [pfact('a', 'Budget is $40,000.'), pfact('b', 'Start date is 1 March.')];
    const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, FORMAT] });
    const sent = factsForRequest(own, inh);
    expect(sent.map((f) => f.statement)).toEqual(['Budget is $40,000.', 'Start date is 1 March.', 'Reports go to the client as PDF.', 'The client handles reference checks.']);
    expect(factCitedAs('F2', 'Start date is 1 March.', own)?.id).toBe('b');
  });

  it('a project fact that replaces a default carries the default with it', () => {
    const own = [pfact('pf', 'We take references ourselves here.', { overrides_folder_fact: 'refs' })];
    const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS], projectFacts: own });
    expect(factsForRequest(own, inh)).toEqual([
      expect.objectContaining({ statement: own[0].statement, replaces_default: 'The client handles reference checks. (the default of the client folder "Acme")' }),
    ]);
  });

  it('sends at most the cap, required ones kept', () => {
    const many = Array.from({ length: MAX_INHERITED_SENT + 5 }, (_, i) => rule(`r${i}`, 'acme', `Rule ${i}.`, { required: i === MAX_INHERITED_SENT + 4 }));
    const out = inheritedForRequest(resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: many }));
    expect(out.facts).toHaveLength(MAX_INHERITED_SENT);
    expect(out.notSent).toBe(5);
    expect(out.facts[0].required).toBe(true);
  });

  it("puts the folders' documents after the project's own material, nearest folder first, each under a heading", () => {
    const inh = resolveInherited({
      folders: FOLDERS, folderId: 'cfo', facts: [],
      documents: [doc('d1', 'acme', 'Agreement.pdf', 'Fee is one third.'), doc('d2', 'cfo', 'Spec.docx', 'Led an IPO.')],
    });
    expect(materialWithInherited('Own notes.', inh)).toBe(
      'Own notes.\n\n### From Spec.docx (the search folder "CFO search")\n\nLed an IPO.\n\n### From Agreement.pdf (the client folder "Acme")\n\nFee is one third.'
    );
    expect(materialWithInherited('Own notes.', undefined)).toBe('Own notes.');
  });
});
