import { describe, expect, it } from 'vitest';

import type { ProjectJob } from '@/lib/supabase/jobs';
import type { OutlineSection } from '@/types';
import { classifyWait } from './await';

const section = (id: string, status: OutlineSection['status'], error: string | null = null): OutlineSection =>
  ({ id, title: id.toUpperCase(), abstract: '', status, content: status === 'complete' ? 'text' : '', error }) as OutlineSection;
const job = (sectionId: string, status: ProjectJob['status'], error_message: string | null = null): ProjectJob =>
  ({ id: `j-${sectionId}-${status}`, status, payload: { section_id: sectionId }, error_message }) as unknown as ProjectJob;

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
