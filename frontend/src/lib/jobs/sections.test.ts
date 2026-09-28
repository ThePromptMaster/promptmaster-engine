import { describe, expect, it, vi } from 'vitest';

const enqueueSectionJob = vi.hoisted(() => vi.fn<(args: unknown) => Promise<string | null>>(async () => 'job'));
vi.mock('@/lib/supabase/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/jobs')>();
  return { ...actual, enqueueSectionJob };
});

import type { ProjectJob } from '@/lib/supabase/jobs';
import type { OutlineSection } from '@/types';
import type { Project } from '@/types/project';
import {
  enqueueDraftJobs,
  enqueueRevisionJobs,
  jobBySection,
  manuscriptSnapshot,
  pendingJobs,
  revisedCount,
  stoppedSections,
  unwrittenSections,
  writtenSections,
} from './sections';
import { appliedFindingsVersion } from '@/lib/workflow/apply-findings';

const section = (id: string, status: OutlineSection['status'], revision = 0): OutlineSection =>
  ({ id, title: id.toUpperCase(), abstract: '', status, content: status === 'complete' ? `Text of ${id}.` : '', revision }) as OutlineSection;
const job = (sectionId: string, status: ProjectJob['status'], stageId = 'drafting', revision = 0): ProjectJob =>
  ({ id: `j-${sectionId}-${status}`, status, payload: { section_id: sectionId, stage_id: stageId, revision } }) as unknown as ProjectJob;
const project = { id: 'p1', user_id: 'u1', model: 'm', mode: 'architect', objective: 'o', audience: '', constraints: '', output_format: '', custom_name: '', custom_preamble: '', custom_tone: '', session_facts: [] } as unknown as Project;

describe('section helpers (B2a) — pure', () => {
  const outline = [section('a', 'complete', 1), section('b', 'pending'), section('c', 'error')];

  it('splits written from unwritten, in outline order', () => {
    expect(unwrittenSections(outline).map((t) => [t.section.id, t.index])).toEqual([['b', 1], ['c', 2]]);
    expect(writtenSections(outline).map((t) => t.section.id)).toEqual(['a']);
  });

  it('pending jobs are queued or leased; the latest job per section wins', () => {
    const jobs = [job('b', 'failed'), job('b', 'queued'), job('c', 'dead'), job('a', 'succeeded')];
    expect(pendingJobs(jobs).map((j) => j.id)).toEqual(['j-b-queued']);
    expect(jobBySection(jobs).get('b')?.status).toBe('queued');
    expect(stoppedSections(outline, jobs).map((t) => t.section.id)).toEqual(['c']);
  });

  it('counts a section as revised by this stage once any of its jobs for this stage succeeded', () => {
    const jobs = [job('a', 'succeeded', 'revision'), job('a', 'succeeded', 'editing'), job('b', 'failed', 'revision')];
    expect(revisedCount(outline, jobs, 'revision')).toBe(1);
    expect(revisedCount(outline, jobs, 'editing')).toBe(1);
    expect(revisedCount(outline, jobs, 'drafting')).toBe(0);
  });

  it('the snapshot is the manuscript as it stands, labelled for the pass', () => {
    const v = manuscriptSnapshot(outline, 'Revision', 'architect');
    expect(v.source_operation).toBe('manuscript_snapshot');
    expect(v.content).toContain('## 1. A');
    expect(v.content).not.toContain('## 2.');
    expect(v.instruction).toBe('Before Revision');
  });

  it('an applied-findings version names its source', () => {
    const v = appliedFindingsVersion(
      { findings: [{ id: 'f', category: 'c', summary: 'Cut the intro', suggested_change: '' }], before: 'a', after: 'b', instruction: 'i', finishReason: 'stop', source: 'the stage check' },
      { model: 'm', mode: 'architect' }
    );
    expect(v).toMatchObject({ content: 'b', source_operation: 'applied_findings', change_summary: 'Applied from the stage check: Cut the intro' });
  });
});

describe('enqueueing (B2a) — the same calls the buttons make', () => {
  const outline = [section('a', 'complete', 1), section('b', 'pending'), section('c', 'error', 2)];

  it('drafts every unwritten section, bumping past a stopped job', async () => {
    enqueueSectionJob.mockClear();
    const queued = await enqueueDraftJobs({
      project, artifactId: 'art', stageId: 'drafting', outline, approvedOutlineVersionId: 'ov',
      jobs: [job('c', 'dead', 'drafting', 2)],
    });
    expect(queued).toEqual(['b', 'c']);
    const calls = enqueueSectionJob.mock.calls.map((c) => c[0] as { sectionId: string; revision: number; revise?: unknown });
    expect(calls.map((c) => [c.sectionId, c.revision])).toEqual([['b', 0], ['c', 3]]);
    expect(calls.every((c) => c.revise === undefined)).toBe(true);
  });

  it('drafts only the sections named when asked', async () => {
    enqueueSectionJob.mockClear();
    const queued = await enqueueDraftJobs({
      project, artifactId: 'art', stageId: 'drafting', outline, approvedOutlineVersionId: 'ov', jobs: [], sectionIds: ['c'],
    });
    expect(queued).toEqual(['c']);
  });

  it('a revision saves the snapshot first, then queues a rewrite of each written section', async () => {
    enqueueSectionJob.mockClear();
    const order: string[] = [];
    enqueueSectionJob.mockImplementation(async () => { order.push('job'); return 'job'; });
    const queued = await enqueueRevisionJobs({
      project, artifactId: 'art', stageId: 'revision', outline, approvedOutlineVersionId: 'ov',
      brief: { stageLabel: 'Revision', instruction: 'Tighten it.', findings: [{ source: 'Continuity', text: 'Ch 3 repeats Ch 1' }] as never, sources: ['Continuity'] },
      saveSnapshot: async () => { order.push('snapshot'); },
    });
    expect(queued).toEqual(['a']);
    expect(order).toEqual(['snapshot', 'job']);
    const call = enqueueSectionJob.mock.calls[0][0] as { revision: number; revise: { stage_label: string; notes: string } };
    expect(call.revision).toBe(2);
    expect(call.revise.stage_label).toBe('Revision');
    expect(call.revise.notes).toContain('Ch 3 repeats Ch 1');
  });
});
