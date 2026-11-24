import { describe, expect, it } from 'vitest';

import { buildInputsUsed, changedSince, folderKey } from './inputs-used';
import { resolveInherited } from './inheritance';
import type { FolderException, FolderFact, ProjectFact, ProjectFolder } from '@/types/project';

const folder = (id: string, name: string, parent: string | null, kind: ProjectFolder['kind']): ProjectFolder => ({
  id, name, parent_id: parent, kind, user_id: 'u', position: 0, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:00:00Z',
});
const FOLDERS = [folder('acme', 'Acme', null, 'client'), folder('cfo', 'CFO search', 'acme', 'search'), folder('vp', 'VP search', 'acme', 'search')];
const rule = (id: string, folderId: string, statement: string, extra: Partial<FolderFact> = {}): FolderFact => ({
  id, folder_id: folderId, user_id: 'u', statement, subject: null, kind: 'requirement', required: false, source_kind: 'typed', source_ref: {},
  origin: 'user_stated', supersedes: null, overrides: null, retired_at: null, retired_reason: null, created_at: '2026-11-24T00:00:00Z', ...extra,
});
const fact = (id: string, statement: string, extra: Partial<ProjectFact> = {}): ProjectFact => ({
  id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'brief', source_ref: {}, accepted_by: 'user',
  agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-11-24T01:00:00Z', ...extra,
});
const TOPICS = rule('topics', 'cfo', 'Every review covers notice period, compensation and the carve-out.');
const REFS = rule('refs', 'acme', 'The client handles reference checks.', { required: true });

describe('what a version used', () => {
  const inh = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, TOPICS], documents: [
    { id: 'd', folder_id: 'cfo', user_id: 'u', name: 'Spec.pdf', text: 'Spec text', source_ref: {}, retired_at: null, retired_reason: null, created_at: '2026-11-24T00:00:00Z' },
  ] });
  const used = buildInputsUsed({
    template: { id: 't1', key: 'custom_tr', version: 2, name: 'Transcript review' },
    stage: { id: 'review', label: 'Review transcript', instruction: 'Note topics covered and answers needing follow-up.' },
    model: 'anthropic/claude-opus-5.5',
    facts: [fact('f1', 'Candidate: Jordan Lee.'), fact('f0', 'Old', { retired_at: '2026-11-24T00:30:00Z' })],
    inherited: inh, inFolder: true,
    context: 'Notes.\n\n### From Interview.docx\n\nTranscript text',
  });

  it('records the workflow version, stage, model, requirements by level and documents', () => {
    expect(used.template).toEqual({ id: 't1', key: 'custom_tr', version: 2, name: 'Transcript review' });
    expect(used.stage.instruction).toBe('Note topics covered and answers needing follow-up.');
    expect(used.requirements.project.map((f) => f.statement)).toEqual(['Candidate: Jordan Lee.']);
    expect(used.requirements.inherited?.map((r) => [r.statement, r.level.name, r.required])).toEqual([
      ['The client handles reference checks.', 'Acme', true],
      ['Every review covers notice period, compensation and the carve-out.', 'CFO search', false],
    ]);
    expect(used.documents.map((d) => [d.name, d.level?.name ?? null])).toEqual([['Interview.docx', null], ['Spec.pdf', 'CFO search']]);
    expect(used.requirements.folder_key).toBe(folderKey(inh));
  });

  it('says the folders could not be read rather than recording none', () => {
    const unread = buildInputsUsed({ template: null, stage: { id: 's', label: 'S' }, model: '', facts: [], inherited: undefined, inFolder: true, context: '' });
    expect(unread.requirements.inherited).toBeNull();
    expect(buildInputsUsed({ template: null, stage: { id: 's', label: 'S' }, model: '', facts: [], inherited: undefined, inFolder: false, context: '' }).requirements.inherited).toEqual([]);
  });

  it("a required topic added at the search is a new key, and is said as what changed since", () => {
    const added = rule('topics2', 'cfo', 'Every review covers whether the candidate would relocate.', { required: true });
    const now = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, TOPICS, added] });
    expect(folderKey(now)).not.toBe(used.requirements.folder_key);
    expect(changedSince(used, now)).toEqual({ added: ['Every review covers whether the candidate would relocate.'], removed: [] });
  });

  it('the other search keeps its own key, and an exception in a folder changes it', () => {
    const vp = resolveInherited({ folders: FOLDERS, folderId: 'vp', facts: [REFS, TOPICS] });
    expect(folderKey(vp)).not.toBe(folderKey(inh));
    const ex: FolderException = {
      id: 'e1', user_id: 'u', folder_id: 'cfo', project_id: null, rule_id: 'refs', statement: 'We run references here.', authorised_by: 'Dana',
      how_confirmed: 'email', reason: 'asked', from_note: {}, retired_at: null, retired_reason: null, created_at: '2026-11-24T02:00:00Z',
    };
    const withEx = resolveInherited({ folders: FOLDERS, folderId: 'cfo', facts: [REFS, TOPICS], exceptions: [ex] });
    expect(folderKey(withEx)).not.toBe(folderKey(inh));
    expect(changedSince(used, withEx)).toEqual({ added: ['We run references here.'], removed: ['The client handles reference checks.'] });
  });

  it('no folders, no key', () => {
    expect(folderKey(resolveInherited({ folders: FOLDERS, folderId: null, facts: [] }))).toBeNull();
  });
});
