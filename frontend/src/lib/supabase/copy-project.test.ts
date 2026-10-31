import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const copy = vi.fn();
const from = vi.fn(() => ({ copy }));
vi.mock('./client', () => ({ createClient: () => ({ rpc, storage: { from } }) }));

import { copyProject, copyTitle } from './copy-project';

/** 31 Oct: "more like a copy thing … so you have the original project too". */
describe('making a copy of a project', () => {
  beforeEach(() => {
    rpc.mockReset();
    copy.mockReset();
    from.mockClear();
  });

  it('asks the database for the copy, then copies the stored files it names', async () => {
    rpc.mockResolvedValue({
      data: { project_id: 'new', objects: [{ bucket: 'project-files', from: 'u/old/f-a.csv', to: 'u/new/f-a.csv' }] },
      error: null,
    });
    copy.mockResolvedValue({ error: null });
    expect(await copyProject('old')).toEqual({ projectId: 'new', missing: [] });
    expect(rpc).toHaveBeenCalledWith('copy_project', { src: 'old' });
    expect(from).toHaveBeenCalledWith('project-files');
    expect(copy).toHaveBeenCalledWith('u/old/f-a.csv', 'u/new/f-a.csv');
  });

  it('a file that will not copy is named; the copy still stands', async () => {
    rpc.mockResolvedValue({ data: { project_id: 'new', objects: [{ bucket: 'project-files', from: 'u/old/f-a.csv', to: 'u/new/f-a.csv' }] }, error: null });
    copy.mockResolvedValue({ error: { message: 'nope' } });
    expect(await copyProject('old')).toEqual({ projectId: 'new', missing: ['f-a.csv'] });
  });

  it('a refusal from the database is the error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'project old is not yours to copy' } });
    await expect(copyProject('old')).rejects.toMatchObject({ message: 'project old is not yours to copy' });
    expect(copy).not.toHaveBeenCalled();
  });
});

/** 31 Oct: a long copy's "(copy)" was truncated away, so it looked identical to its original. */
describe('copyTitle', () => {
  it('splits off the suffix copy_project adds, repeated or not', () => {
    expect(copyTitle('A long book (copy)')).toEqual({ base: 'A long book', suffix: '(copy)' });
    expect(copyTitle('Book (copy) (copy)')).toEqual({ base: 'Book', suffix: '(copy) (copy)' });
  });
  it('leaves other titles alone', () => {
    expect(copyTitle('Notes (copy edits)')).toEqual({ base: 'Notes (copy edits)', suffix: '' });
    expect(copyTitle(null)).toEqual({ base: '', suffix: '' });
  });
});
