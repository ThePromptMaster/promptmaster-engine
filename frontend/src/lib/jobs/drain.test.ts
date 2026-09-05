/**
 * FR-05, the only acceptance test the contract spells out:
 *
 *   "A ten-section test project can begin generation, preserve at least three
 *    completed sections, survive browser closure, and resume from an incomplete
 *    section. Completed sections are not regenerated unless the user requests it."
 *
 * The load-bearing assertion in this file is that every section's prose is
 * generated exactly once. "Was not regenerated" is a claim about calls, not
 * about content, so it is asserted by counting calls into the generator — which
 * is the reason `drain.ts` takes a `SectionGenerator` interface rather than
 * calling `fetch` itself.
 *
 * The fake store below implements the lease semantics of the SQL functions:
 * claim skips projects that already have a leased job, writes are refused unless
 * the caller still holds the lease, and reaping returns expired leases to the
 * queue. It is not a mock — a mock would let the test pass while the real
 * ordering guarantee was broken.
 */

import { describe, expect, it } from 'vitest';

import { runDrain } from './drain';
import {
  DRAFT_SECTION,
  type DraftCheckpoint,
  type DraftSectionPayload,
  type Job,
  type JobStore,
  type OutlineSectionState,
  type SectionContext,
  type SectionGenerator,
  type SectionRecord,
  type WriteSectionResult,
} from './types';
import type { PMInput } from '@/types';

const PROJECT = 'proj-1';
const ARTIFACT = 'art-1';
const USER = 'user-1';
const OUTLINE_VERSION = 'ver-1';

const INPUTS: PMInput = {
  objective: 'Write a ten-section book about resumable systems.',
  audience: 'Engineering leads',
  constraints: '',
  output_format: '',
  mode: 'architect',
  session_facts: [],
};

// ---------------------------------------------------------------------------
// A clock the test drives
// ---------------------------------------------------------------------------

class Clock {
  private t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

// ---------------------------------------------------------------------------
// The fake store
// ---------------------------------------------------------------------------

interface FakeJobRow extends Job {
  leased_until: number | null;
  run_after: number;
  created_at: number;
  checkpoint: Record<string, unknown>;
  idempotency_key: string;
  error_code?: string;
  error_message?: string;
}

class FakeStore implements JobStore {
  jobs: FakeJobRow[] = [];
  outline: OutlineSectionState[] = [];
  records: SectionRecord[] = [];
  /** Every refused write, so the tests can assert a stale worker was blocked. */
  refusedWrites = 0;

  constructor(private clock: Clock) {}

  enqueue(sectionIndex: number, section: OutlineSectionState, revision = 0): void {
    const key = `draft:${OUTLINE_VERSION}:${section.id}:${revision}`;
    // on conflict do nothing — the idempotency guarantee.
    if (this.jobs.some((j) => j.project_id === PROJECT && j.idempotency_key === key)) return;

    const payload: DraftSectionPayload = {
      project_id: PROJECT,
      artifact_id: ARTIFACT,
      stage_id: 'drafting',
      section_id: section.id,
      section_index: sectionIndex,
      outline_version_id: OUTLINE_VERSION,
      revision,
      model: 'test-model',
      inputs: INPUTS,
    };
    this.jobs.push({
      id: `job-${section.id}-${revision}`,
      user_id: USER,
      project_id: PROJECT,
      kind: DRAFT_SECTION,
      status: 'queued',
      payload: payload as unknown as Record<string, unknown>,
      checkpoint: {},
      attempts: 0,
      max_attempts: 3,
      lease_owner: null,
      cancel_requested: false,
      leased_until: null,
      run_after: this.clock.now(),
      created_at: this.clock.now() + sectionIndex,
      idempotency_key: key,
    });
  }

  async reapExpiredLeases(): Promise<number> {
    let n = 0;
    for (const job of this.jobs) {
      if (job.status !== 'leased') continue;
      if (job.leased_until === null || job.leased_until >= this.clock.now()) continue;
      // attempts already counted at claim, so a worker that dies every time
      // cannot retry forever.
      job.status = job.attempts >= job.max_attempts ? 'dead' : 'queued';
      job.lease_owner = null;
      job.leased_until = null;
      job.run_after = this.clock.now();
      n += 1;
    }
    return n;
  }

  async claimNextJob(worker: string, leaseSeconds: number, projectId?: string | null): Promise<Job | null> {
    // Atomic by construction: no await between the check and the write, which is
    // how the real function's FOR UPDATE SKIP LOCKED behaves from the caller's
    // point of view.
    const busyProjects = new Set(
      this.jobs.filter((j) => j.status === 'leased').map((j) => j.project_id)
    );
    const ready = this.jobs
      .filter(
        (j) =>
          j.status === 'queued' &&
          j.run_after <= this.clock.now() &&
          !j.cancel_requested &&
          (!projectId || j.project_id === projectId) &&
          !busyProjects.has(j.project_id)
      )
      .sort((a, b) => a.created_at - b.created_at);

    const job = ready[0];
    if (!job) return null;

    job.status = 'leased';
    job.lease_owner = worker;
    job.leased_until = this.clock.now() + leaseSeconds * 1000;
    job.attempts += 1;
    return { ...job };
  }

  private held(jobId: string, worker: string): FakeJobRow | null {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'leased' || job.lease_owner !== worker) {
      this.refusedWrites += 1;
      return null;
    }
    return job;
  }

  async checkpointJob(jobId: string, worker: string, checkpoint: DraftCheckpoint): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.checkpoint = { ...checkpoint } as unknown as Record<string, unknown>;
    return true;
  }

  async completeJob(jobId: string, worker: string): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = 'succeeded';
    job.lease_owner = null;
    job.leased_until = null;
    return true;
  }

  async failJob(
    jobId: string,
    worker: string,
    code: string,
    message: string,
    _detail: Record<string, unknown>,
    retryable: boolean
  ): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = !retryable ? 'failed' : job.attempts >= job.max_attempts ? 'dead' : 'queued';
    job.lease_owner = null;
    job.leased_until = null;
    job.error_code = code;
    job.error_message = message;
    return true;
  }

  async releaseJob(jobId: string, worker: string, runAfterSeconds: number): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = 'queued';
    job.lease_owner = null;
    job.leased_until = null;
    // The attempt is given back: stopping cleanly is not a failure.
    job.attempts = Math.max(job.attempts - 1, 0);
    job.run_after = this.clock.now() + runAfterSeconds * 1000;
    return true;
  }

  async loadSectionContext(payload: DraftSectionPayload): Promise<SectionContext> {
    const section = this.outline.find((s) => s.id === payload.section_id) ?? null;
    const prev = payload.section_index > 0 ? this.outline[payload.section_index - 1] : null;
    return {
      outline: this.outline.map((s) => ({ ...s })),
      section: section ? { ...section } : null,
      records: this.records.filter((r) => r.section_index < payload.section_index),
      prevSectionContent: prev?.content ?? '',
    };
  }

  async writeSection(args: {
    artifactId: string;
    worker: string;
    sectionId: string;
    content: string;
    finishReason: string;
    outlineVersionId: string | null;
  }): Promise<WriteSectionResult> {
    const idx = this.outline.findIndex((s) => s.id === args.sectionId);
    const section = this.outline[idx];
    section.content = args.content;
    section.status = 'complete';
    section.finish_reason = args.finishReason;
    section.outline_version_id = args.outlineVersionId;
    section.revision = (section.revision ?? 0) + 1;
    return {
      section_index: idx,
      sections_total: this.outline.length,
      sections_complete: this.outline.filter((s) => s.status === 'complete').length,
    };
  }

  async writeSectionRecord(args: { record: SectionRecord }): Promise<void> {
    const i = this.records.findIndex((r) => r.section_id === args.record.section_id);
    if (i >= 0) this.records[i] = args.record;
    else this.records.push(args.record);
  }

  // --- test affordances ----------------------------------------------------

  /**
   * What Vercel leaves behind. The function is killed, so no failure is written
   * and no lease is released; the row just sits in `leased` with a timestamp in
   * the past. Nothing detects the death — the absence of a heartbeat is the
   * detection, and only `reapExpiredLeases` ever looks.
   */
  simulateWorkerDeath(jobId: string): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'leased') throw new Error(`job ${jobId} is not leased`);
    job.leased_until = this.clock.now() - 1;
  }

  jobFor(sectionId: string): FakeJobRow {
    const job = this.jobs.find((j) => (j.payload as { section_id: string }).section_id === sectionId);
    if (!job) throw new Error(`no job for ${sectionId}`);
    return job;
  }

  get completedSections(): OutlineSectionState[] {
    return this.outline.filter((s) => s.status === 'complete');
  }
}

// ---------------------------------------------------------------------------
// The generator, which counts calls
// ---------------------------------------------------------------------------

class CountingGenerator implements SectionGenerator {
  proseCalls: string[] = [];
  recordCalls: string[] = [];
  /** Sections whose prose call should throw, and with what. */
  proseFailures = new Map<string, Error>();

  constructor(private clock: Clock, private msPerCall = 5_000) {}

  async generateSectionProse(req: {
    outline: OutlineSectionState[];
    section_index: number;
  }): Promise<{ content: string; finish_reason: string }> {
    const section = req.outline[req.section_index];
    this.clock.advance(this.msPerCall);
    const failure = this.proseFailures.get(section.id);
    if (failure) throw failure;
    this.proseCalls.push(section.id);
    // Content is unique per call, so a duplicate write is detectable as content
    // rather than only as a count.
    return {
      content: `prose for ${section.id} (call ${this.proseCalls.length})`,
      finish_reason: 'stop',
    };
  }

  async extractSectionRecord(req: {
    section_id: string;
    section_index: number;
    section_title: string;
    existing_terms: string[];
  }): Promise<{ record: SectionRecord }> {
    this.clock.advance(this.msPerCall);
    this.recordCalls.push(req.section_id);
    return {
      record: {
        section_id: req.section_id,
        section_index: req.section_index,
        title: req.section_title,
        summary: `summary of ${req.section_id}`,
        glossary_terms: [{ term: `term-${req.section_index}`, definition: 'd' }],
        decisions: [],
        todos: [],
      },
    };
  }
}

function tenSections(): OutlineSectionState[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    title: `Section ${i}`,
    abstract: `Covers topic ${i}.`,
    status: 'pending' as const,
    content: '',
  }));
}

function setup(msPerCall = 5_000) {
  const clock = new Clock();
  const store = new FakeStore(clock);
  store.outline = tenSections();
  store.outline.forEach((s, i) => store.enqueue(i, s));
  const generator = new CountingGenerator(clock, msPerCall);
  return { clock, store, generator };
}

function drain(store: FakeStore, generator: SectionGenerator, clock: Clock, worker: string, budgetMs: number) {
  return runDrain({
    store,
    generator,
    worker,
    budgetMs,
    leaseSeconds: 120,
    projectId: PROJECT,
    now: clock.now,
  });
}

// ---------------------------------------------------------------------------
// FR-05
// ---------------------------------------------------------------------------

describe('FR-05: resumable ten-section drafting', () => {
  it('preserves completed sections across a worker death and resumes the incomplete one', async () => {
    const { clock, store, generator } = setup();

    // --- begin generation, with a budget that runs out partway through -------
    // Each section costs two 5s calls, so a 60s budget completes a handful and
    // leaves the queue live.
    await drain(store, generator, clock, 'worker-1', 60_000);

    // "preserve at least three completed sections"
    expect(store.completedSections.length).toBeGreaterThanOrEqual(3);
    const completedAfterFirstRun = store.completedSections.map((s) => s.id);

    // --- the browser closes mid-section --------------------------------------
    // Drive one more section to the point where its prose is committed but its
    // record is not, then kill the worker exactly there. This is the window the
    // whole design exists for: the tokens are spent and the prose is on disk.
    const nextSection = store.outline.find((s) => s.status !== 'complete')!;
    const job = store.jobFor(nextSection.id);

    await store.claimNextJob('worker-doomed', 120, PROJECT);
    const prose = await generator.generateSectionProse({
      outline: store.outline,
      section_index: store.outline.indexOf(nextSection),
    });
    await store.writeSection({
      artifactId: ARTIFACT,
      worker: 'worker-doomed',
      sectionId: nextSection.id,
      content: prose.content,
      finishReason: prose.finish_reason,
      outlineVersionId: OUTLINE_VERSION,
    });
    await store.checkpointJob(job.id, 'worker-doomed', { step: 'record', prose_written: true });
    store.simulateWorkerDeath(job.id);

    const proseCallsAtDeath = [...generator.proseCalls];

    // --- reopen: the lease has expired, cron drains again --------------------
    clock.advance(200_000);
    for (let i = 0; i < 20; i += 1) {
      const report = await drain(store, generator, clock, `worker-${i + 2}`, 60_000);
      if (report.claimed === 0) break;
    }

    // Every section written, exactly once.
    expect(store.completedSections).toHaveLength(10);

    // THE assertion: no section's prose was generated twice.
    const counts = new Map<string, number>();
    for (const id of generator.proseCalls) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
    expect(generator.proseCalls).toHaveLength(10);

    // The sections finished before the crash were never touched again.
    for (const id of completedAfterFirstRun) {
      expect(generator.proseCalls.filter((c) => c === id)).toHaveLength(1);
    }

    // And the section that died mid-job resumed at its record step rather than
    // regenerating: its prose count did not move after the death.
    expect(generator.proseCalls.filter((c) => c === nextSection.id)).toHaveLength(
      proseCallsAtDeath.filter((c) => c === nextSection.id).length
    );
    expect(generator.recordCalls).toContain(nextSection.id);
  });

  it('resumes at the record step when the checkpoint says the prose is committed', async () => {
    const { clock, store, generator } = setup();

    // Section 0 already written by a previous run that died before extraction.
    store.outline[0].status = 'complete';
    store.outline[0].content = 'prose written by the run that died';
    const job = store.jobFor('s0');
    job.checkpoint = { step: 'record', prose_written: true };

    await drain(store, generator, clock, 'worker-1', 30_000);

    expect(generator.proseCalls).not.toContain('s0');
    expect(generator.recordCalls).toContain('s0');
    expect(store.outline[0].content).toBe('prose written by the run that died');
  });

  it('does not regenerate prose even when the checkpoint was lost', async () => {
    // The narrow window where write_long_form_section committed but
    // checkpoint_job never landed. The checkpoint still says 'prose'; the
    // artifact says otherwise, and the artifact wins.
    const { clock, store, generator } = setup();

    store.outline[0].status = 'complete';
    store.outline[0].content = 'committed, but never checkpointed';
    expect(store.jobFor('s0').checkpoint).toEqual({});

    await drain(store, generator, clock, 'worker-1', 30_000);

    expect(generator.proseCalls).not.toContain('s0');
    expect(store.outline[0].content).toBe('committed, but never checkpointed');
  });

  it('re-enqueueing a finished section is a no-op, but a regenerate is not', async () => {
    const { store } = setup();
    const before = store.jobs.length;

    // Same outline version, same revision -> same idempotency key -> nothing.
    store.outline.forEach((s, i) => store.enqueue(i, s));
    expect(store.jobs).toHaveLength(before);

    // A user-requested regenerate carries a new revision, so it is a new row.
    store.enqueue(0, store.outline[0], 1);
    expect(store.jobs).toHaveLength(before + 1);
  });

  it('records what survived when a section fails', async () => {
    const { clock, store, generator } = setup();

    // Let a few sections land, then break the next one for a reason that is not
    // worth retrying.
    await drain(store, generator, clock, 'worker-1', 40_000);
    const next = store.outline.find((s) => s.status !== 'complete')!;
    generator.proseFailures.set(next.id, Object.assign(new Error('HTTP 402'), { status: 402 }));

    await drain(store, generator, clock, 'worker-2', 40_000);

    const failed = store.jobFor(next.id);
    expect(failed.error_code).toBe('insufficient_credits');
    // The FR-16 rule: the message must say what is safe.
    expect(failed.error_message!).toMatch(/Nothing was lost — \d+ of 10 sections are saved\./);
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe('concurrent drains', () => {
  it('runs ten sections in order with no duplicated work across three drains', async () => {
    const { clock, store, generator } = setup(1_000);

    // Cron, a visible tab and a second tab, all draining the same project at
    // once. The lease is what makes this safe; the point of the test is that it
    // is also correct — section N+1's context depends on N's record, so the
    // order must hold.
    await Promise.all([
      drain(store, generator, clock, 'worker-a', 400_000),
      drain(store, generator, clock, 'worker-b', 400_000),
      drain(store, generator, clock, 'worker-c', 400_000),
    ]);

    expect(store.completedSections).toHaveLength(10);

    // Strict ordering: sections were written 0,1,2,...,9.
    expect(generator.proseCalls).toEqual(
      Array.from({ length: 10 }, (_, i) => `s${i}`)
    );

    // No duplicate content anywhere — each section holds the output of exactly
    // one call.
    const contents = store.outline.map((s) => s.content);
    expect(new Set(contents).size).toBe(10);
    for (const content of contents) {
      expect(content).toMatch(/^prose for s\d+ \(call \d+\)$/);
    }
  });

  it('refuses writes from a worker whose lease was reaped', async () => {
    const { clock, store } = setup();

    const claimed = await store.claimNextJob('worker-slow', 120, PROJECT);
    expect(claimed).not.toBeNull();
    store.simulateWorkerDeath(claimed!.id);

    clock.advance(200_000);
    await store.reapExpiredLeases();
    const reclaimed = await store.claimNextJob('worker-fresh', 120, PROJECT);
    expect(reclaimed!.id).toBe(claimed!.id);

    // The original worker wakes up and tries to finish. It must be refused, or
    // it would overwrite the newer attempt's work.
    const before = store.refusedWrites;
    expect(await store.completeJob(claimed!.id, 'worker-slow')).toBe(false);
    expect(store.refusedWrites).toBe(before + 1);
    expect(await store.completeJob(claimed!.id, 'worker-fresh')).toBe(true);
  });

  it('only one drain holds a project at a time', async () => {
    const { store } = setup();

    const a = await store.claimNextJob('worker-a', 120, PROJECT);
    const b = await store.claimNextJob('worker-b', 120, PROJECT);

    expect(a).not.toBeNull();
    // jobs_one_active_per_project: the second drain finds nothing to do here.
    expect(b).toBeNull();
  });
});
