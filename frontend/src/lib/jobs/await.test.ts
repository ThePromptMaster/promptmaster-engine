import { describe, expect, it } from 'vitest';

import type { ProjectJob } from '@/lib/supabase/jobs';
import type { OutlineSection } from '@/types';
import { classifyWait } from './await';

const section = (id: string, status: OutlineSection['status'], error: string | null = null): OutlineSection =>
  ({ id, title: id.toUpperCase(), abstract: '', status, content: status === 'complete' ? 'text' : '', error }) as OutlineSection;
const job = (sectionId: string, status: ProjectJob['status'], error_message: string | null = null): ProjectJob =>
  ({ id: `j-${sectionId}-${status}`, status, payload: { section_id: sectionId }, error_message }) as unknown as ProjectJob;

describe('classifyWait: what stopped a job travels with the failure', () => {
  it('carries the error code, so credit running out is not read as a failed section', () => {
    const dead = { ...job('b', 'dead', 'Out of model credits'), error_code: 'insufficient_credits' };
    const r = classifyWait([section('b', 'error', 'Out of model credits')], [dead], ['b']);
    expect(r.failed).toEqual([{ sectionId: 'b', title: 'B', message: 'Out of model credits', code: 'insufficient_credits' }]);
  });
});

describe('classifyWait: a rewrite that failed did not write the section (8 Nov, production)', () => {
  const written = (revision: number) => ({ ...section('a', 'complete'), revision }) as OutlineSection;
  const jobAt = (status: ProjectJob['status'], revision: number) => ({ id: 'j', status, payload: { section_id: 'a', revision }, error_message: 'It failed.' }) as unknown as ProjectJob;

  it('a section left complete by a job that failed at a later revision is a failure', () => {
    const r = classifyWait([written(1)], [jobAt('dead', 2)], ['a']);
    expect(r.written).toEqual([]);
    expect(r.failed.map((f) => f.sectionId)).toEqual(['a']);
  });

  it('a job that died after its prose was saved did write it', () => {
    const r = classifyWait([written(2)], [jobAt('failed', 2)], ['a']);
    expect(r.written).toEqual(['a']);
    expect(r.failed).toEqual([]);
  });

  it('a cancelled job stays as before: the section stands', () => {
    expect(classifyWait([written(1)], [jobAt('cancelled', 2)], ['a']).written).toEqual(['a']);
  });
});

describe('classifyWait: where the sections a step queued stand (B2b)', () => {
  it('settles when every targeted section is written', () => {
    const r = classifyWait([section('a', 'complete'), section('b', 'complete'), section('c', 'pending')], [job('a', 'succeeded'), job('b', 'succeeded')], ['a', 'b']);
    expect(r).toMatchObject({ written: ['a', 'b'], failed: [], pending: [], complete: 2, total: 3, settled: true });
  });

  it('keeps waiting while a targeted section is queued or leased', () => {
    const r = classifyWait([section('a', 'complete'), section('b', 'writing')], [job('a', 'succeeded'), job('b', 'leased')], ['a', 'b']);
    expect(r.pending).toEqual(['b']);
    expect(r.settled).toBe(false);
  });

  it('a section whose job stopped for good is a failure with its reason, and settles', () => {
    const r = classifyWait(
      [section('a', 'complete'), section('b', 'error', 'Out of model credits')],
      [job('a', 'succeeded'), job('b', 'dead', 'insufficient_credits')],
      ['a', 'b']
    );
    expect(r.written).toEqual(['a']);
    expect(r.failed).toEqual([{ sectionId: 'b', title: 'B', message: 'Out of model credits' }]);
    expect(r.settled).toBe(true);
  });

  it('a queued job wins over a stale error on the section: it is being retried', () => {
    const r = classifyWait([section('b', 'error', 'earlier failure')], [job('b', 'dead'), job('b', 'queued')], ['b']);
    expect(r.pending).toEqual(['b']);
    expect(r.failed).toEqual([]);
  });

  it('only the targeted sections are judged; the rest of the manuscript is context', () => {
    const r = classifyWait([section('a', 'pending'), section('b', 'complete')], [], ['b']);
    expect(r).toMatchObject({ written: ['b'], pending: [], settled: true, complete: 1, total: 2 });
  });
});
