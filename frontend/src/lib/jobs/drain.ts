/**
 * The drain loop: reap, claim, run one checkpointable step, repeat while there
 * is budget left.
 *
 * This module is deliberately free of Supabase, `fetch` and Next.js. It takes a
 * `JobStore` and a `SectionGenerator` and does nothing else, which is what lets
 * the FR-05 acceptance test kill a worker mid-section and then count generator
 * calls to prove the finished sections were not rewritten.
 *
 * The shape of a drafting job is two steps with a commit between them:
 *
 *   1. read context (cheap)
 *   2. LLM call -> write the section artifact, then checkpoint to 'record'
 *   3. LLM call -> write the continuity record, then complete
 *
 * Step 2 is the one that matters. The tokens are paid for the moment the model
 * responds, so the section is committed before anything else is attempted. If
 * the function dies between 2 and 3 the lease expires, the next drain re-claims,
 * and it resumes at 3 — the prose is never regenerated. Today, without this, a
 * tab close discards a section that was already finished and already billed.
 */

import { classifyDrainError, classified, withPreserved } from './errors';
import {
  DRAFT_SECTION,
  type DraftCheckpoint,
  type DraftSectionPayload,
  type Job,
  type JobStore,
  type SectionContext,
  type SectionGenerator,
} from './types';

export interface DrainOptions {
  store: JobStore;
  generator: SectionGenerator;
  /** Identifies this run's lease. Must be unique per concurrent drain. */
  worker: string;
  /** Total wall clock this drain may use, in ms. */
  budgetMs: number;
  /** How long a claimed job is leased for, in seconds. */
  leaseSeconds?: number;
  /** Restrict to one project (the client-driven path always does). */
  projectId?: string | null;
  /** Injectable clock, so tests do not sleep. */
  now?: () => number;
  /** Max jobs one drain will touch, as a backstop against a runaway queue. */
  maxJobs?: number;
}

export interface DrainReport {
  reaped: number;
  claimed: number;
  completed: number;
  released: number;
  failed: number;
  /** Codes observed this run, for the caller to surface. */
  errors: { jobId: string; code: string; message: string }[];
}

/**
 * Reserve held back from the budget so the drain can always finish the write it
 * is in the middle of and hand the lease back cleanly. Without it the loop
 * starts a step it cannot finish and relies on the reaper to clean up, which
 * costs the user a lease interval of apparent stall for no reason.
 */
const BUDGET_RESERVE_MS = 8_000;

/** A step is assumed to need at least this long; below it, stop and release. */
const MIN_STEP_MS = 12_000;

export async function runDrain(options: DrainOptions): Promise<DrainReport> {
  const {
    store,
    generator,
    worker,
    budgetMs,
    leaseSeconds = 120,
    projectId = null,
    now = () => Date.now(),
    maxJobs = 25,
  } = options;

  const startedAt = now();
  const report: DrainReport = {
    reaped: 0,
    claimed: 0,
    completed: 0,
    released: 0,
    failed: 0,
    errors: [],
  };

  const remaining = () => budgetMs - (now() - startedAt);

  // Always first. A lease that expired because the platform killed a function is
  // invisible until something looks for it — nothing wrote a failure, because
  // nothing was alive to write one.
  report.reaped = await store.reapExpiredLeases();

  let handled = 0;
  while (handled < maxJobs && remaining() > BUDGET_RESERVE_MS + MIN_STEP_MS) {
    const job = await store.claimNextJob(worker, leaseSeconds, projectId);
    if (!job) break;

    handled += 1;
    report.claimed += 1;
    await runJob({ job, store, generator, worker, remaining, report });
  }

  return report;
}

interface RunJobArgs {
  job: Job;
  store: JobStore;
  generator: SectionGenerator;
  worker: string;
  remaining: () => number;
  report: DrainReport;
}

async function runJob(args: RunJobArgs): Promise<void> {
  const { job, store, generator, worker, remaining, report } = args;

  if (job.kind !== DRAFT_SECTION) {
    await store.failJob(job.id, worker, 'invalid_request', `Unknown job kind: ${job.kind}`, {}, false);
    report.failed += 1;
    return;
  }

  const payload = job.payload as unknown as DraftSectionPayload;
  let checkpoint = normaliseCheckpoint(job.checkpoint);

  // One checkpointable step per iteration, budget re-checked between them.
  for (;;) {
    if (remaining() < BUDGET_RESERVE_MS + MIN_STEP_MS) {
      // Out of time between steps. Hand the job back rather than letting the
      // lease expire: release_job returns the attempt, because stopping cleanly
      // is not a failure and a long document must not exhaust max_attempts
      // simply by being long.
      await store.releaseJob(job.id, worker, 0);
      report.released += 1;
      return;
    }

    try {
      const outcome = await runStep({ job, payload, checkpoint, store, generator, worker });
      if (outcome.done) {
        report.completed += 1;
        return;
      }
      checkpoint = outcome.checkpoint;
    } catch (error) {
      await recordFailure({ job, payload, store, worker, error, report });
      return;
    }
  }
}

interface StepArgs {
  job: Job;
  payload: DraftSectionPayload;
  checkpoint: DraftCheckpoint;
  store: JobStore;
  generator: SectionGenerator;
  worker: string;
}

type StepOutcome = { done: true } | { done: false; checkpoint: DraftCheckpoint };

async function runStep(args: StepArgs): Promise<StepOutcome> {
  const { job, payload, checkpoint, store, generator, worker } = args;
  const context = await store.loadSectionContext(payload);

  if (!context.section) {
    // The outline changed under us — the section was deleted between enqueue and
    // execution. Not retryable, and not an error worth alarming anyone about.
    await store.completeJob(job.id, worker, { skipped: 'section_no_longer_in_outline' });
    return { done: true };
  }

  if (checkpoint.step === 'prose') {
    // The artifact, not the checkpoint, is the authority on whether prose
    // exists. A worker can die after write_long_form_section commits but before
    // checkpoint_job lands, and in that window the checkpoint still says
    // 'prose'. Regenerating then would rewrite a finished, already-billed
    // section — precisely the FR-05 failure — so the committed section wins.
    if (context.section.status === 'complete' && context.section.content) {
      return {
        done: false,
        checkpoint: {
          step: 'record',
          prose_written: true,
          finish_reason: context.section.finish_reason ?? 'stop',
        },
      };
    }
    return await runProseStep(args, context);
  }

  return await runRecordStep(args, context);
}

async function runProseStep(args: StepArgs, context: SectionContext): Promise<StepOutcome> {
  const { job, payload, store, generator, worker } = args;

  const prose = await generator.generateSectionProse({
    inputs: payload.inputs,
    outline: context.outline,
    section_index: payload.section_index,
    records: context.records,
    prev_section_content: context.prevSectionContent,
    model: payload.model,
    userId: job.user_id,
  });

  // COMMIT. Everything above this line is redoable; everything below is not
  // worth redoing. This ordering is the entire mechanism behind "completed
  // sections are not regenerated".
  await store.writeSection({
    artifactId: payload.artifact_id,
    worker,
    sectionId: payload.section_id,
    content: prose.content,
    finishReason: prose.finish_reason,
    outlineVersionId: payload.outline_version_id,
  });

  const next: DraftCheckpoint = {
    step: 'record',
    prose_written: true,
    finish_reason: prose.finish_reason,
  };
  await store.checkpointJob(job.id, worker, next, 120);
  return { done: false, checkpoint: next };
}

async function runRecordStep(args: StepArgs, context: SectionContext): Promise<StepOutcome> {
  const { job, payload, store, generator, worker } = args;
  const section = context.section!;

  // Only the term NAMES go out, never the definitions and never the prose. That
  // is what keeps this call constant-cost as the glossary grows, and it is the
  // inversion the old whole-document snapshot could not do.
  const existingTerms = context.records.flatMap((r) => r.glossary_terms.map((t) => t.term));

  const { record } = await generator.extractSectionRecord({
    section_id: payload.section_id,
    section_index: payload.section_index,
    section_title: section.title,
    section_content: section.content,
    existing_terms: existingTerms,
    model: payload.model,
    userId: job.user_id,
  });

  await store.writeSectionRecord({
    projectId: payload.project_id,
    artifactId: payload.artifact_id,
    outlineVersionId: payload.outline_version_id,
    record,
  });

  await store.completeJob(job.id, worker, {
    section_id: payload.section_id,
    finish_reason: section.finish_reason ?? 'stop',
  });
  return { done: true };
}

interface FailureArgs {
  job: Job;
  payload: DraftSectionPayload;
  store: JobStore;
  worker: string;
  error: unknown;
  report: DrainReport;
}

async function recordFailure(args: FailureArgs): Promise<void> {
  const { job, payload, store, worker, error, report } = args;
  let outcome = classifyDrainError(error);

  // A job on its last attempt is buried rather than retried, and says so.
  if (outcome.retryable && job.attempts >= job.max_attempts) {
    outcome = classified('job_dead');
  }

  // Say what survived. Best-effort: if even the read fails we would rather ship
  // the bare message than lose the failure entirely.
  let message = outcome.message;
  try {
    const context = await store.loadSectionContext(payload);
    const total = context.outline.length;
    const complete = context.outline.filter((s) => s.status === 'complete').length;
    message = withPreserved(outcome, complete, total).message;
  } catch {
    // Fall through with the unadorned message.
  }

  await store.failJob(
    job.id,
    worker,
    outcome.code,
    message,
    { section_id: payload.section_id, attempts: job.attempts },
    outcome.retryable
  );
  report.failed += 1;
  report.errors.push({ jobId: job.id, code: outcome.code, message });
}

function normaliseCheckpoint(raw: Record<string, unknown> | null | undefined): DraftCheckpoint {
  const step = raw?.step;
  if (step === 'record') {
    return {
      step: 'record',
      prose_written: raw?.prose_written === true,
      finish_reason: typeof raw?.finish_reason === 'string' ? raw.finish_reason : undefined,
    };
  }
  return { step: 'prose' };
}
