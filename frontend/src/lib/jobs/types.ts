/**
 * The job drain's vocabulary, and the two seams that make it testable.
 *
 * `JobStore` and `SectionGenerator` exist so the orchestration in `drain.ts` can
 * be exercised without Postgres or an LLM. That matters more here than it
 * usually would: FR-05's acceptance test is "kill the worker mid-section and
 * prove the completed sections are not regenerated", and the only honest way to
 * assert "was not regenerated" is to count calls into the generator.
 */

import type { PMInput } from '@/types';

export type JobStatus =
  | 'queued'
  | 'leased'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'dead';

export interface Job {
  id: string;
  user_id: string;
  project_id: string;
  kind: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  cancel_requested: boolean;
}

/** The only job kind drafting uses. */
export const DRAFT_SECTION = 'draft_section';

/**
 * Everything the drain needs to write one section, captured at enqueue time.
 *
 * `inputs` travels in the payload rather than being reassembled from the project
 * row, because the backend is stateless and the drain is the only thing that
 * knows both. It is also the reason a job can be resumed hours later by a
 * process that has never seen the user.
 */
export interface DraftSectionPayload {
  project_id: string;
  artifact_id: string;
  stage_id: string;
  section_id: string;
  section_index: number;
  /** FR-07: which approved outline this section is written against. */
  outline_version_id: string | null;
  /** Bumped by a user-requested regenerate, so the idempotency key changes. */
  revision: number;
  model: string;
  inputs: PMInput;
}

/**
 * A drafting job is two steps, and the boundary between them is the whole point.
 *
 * `prose` is expensive and, once it lands, permanent. `record` is cheap and
 * disposable. The checkpoint moves to 'record' only after the prose is committed
 * to the artifact, so a worker killed at any moment either has not written the
 * section yet or has written it and will never write it again.
 */
export type DraftStep = 'prose' | 'record';

export interface DraftCheckpoint {
  step: DraftStep;
  prose_written?: boolean;
  finish_reason?: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  first_seen_section_id?: string;
}

export interface SectionRecord {
  section_id: string;
  section_index: number;
  title: string;
  summary: string;
  glossary_terms: GlossaryTerm[];
  decisions: string[];
  todos: string[];
}

export interface OutlineSectionState {
  id: string;
  title: string;
  abstract: string;
  status: 'pending' | 'writing' | 'complete' | 'error';
  content: string;
  revision?: number;
  finish_reason?: string | null;
  error?: string | null;
  outline_version_id?: string | null;
}

/** What the drain reads before generating: never the whole document. */
export interface SectionContext {
  outline: OutlineSectionState[];
  /** The section this job is about, resolved by id rather than index. */
  section: OutlineSectionState | null;
  /** Prior sections' persisted continuity records (FR-06). */
  records: SectionRecord[];
  /** Tail-anchored previous section, for tone only. */
  prevSectionContent: string;
}

export interface WriteSectionResult {
  section_index: number;
  sections_total: number;
  sections_complete: number;
}

/**
 * Persistence, as the drain sees it. Every method maps onto one SECURITY
 * DEFINER function; nothing here is a plain table write.
 */
export interface JobStore {
  reapExpiredLeases(): Promise<number>;
  claimNextJob(
    worker: string,
    leaseSeconds: number,
    projectId?: string | null
  ): Promise<Job | null>;
  checkpointJob(
    jobId: string,
    worker: string,
    checkpoint: DraftCheckpoint,
    extendSeconds?: number
  ): Promise<boolean>;
  completeJob(jobId: string, worker: string, result: Record<string, unknown>): Promise<boolean>;
  failJob(
    jobId: string,
    worker: string,
    code: string,
    message: string,
    detail: Record<string, unknown>,
    retryable: boolean
  ): Promise<boolean>;
  releaseJob(jobId: string, worker: string, runAfterSeconds: number): Promise<boolean>;

  loadSectionContext(payload: DraftSectionPayload): Promise<SectionContext>;
  writeSection(args: {
    artifactId: string;
    worker: string;
    sectionId: string;
    content: string;
    finishReason: string;
    outlineVersionId: string | null;
  }): Promise<WriteSectionResult>;
  writeSectionRecord(args: {
    projectId: string;
    artifactId: string;
    outlineVersionId: string | null;
    record: SectionRecord;
  }): Promise<void>;
}

/** The generation calls, i.e. the only thing FastAPI is asked for. */
export interface SectionGenerator {
  generateSectionProse(req: {
    inputs: PMInput;
    outline: OutlineSectionState[];
    section_index: number;
    records: SectionRecord[];
    prev_section_content: string;
    model: string;
    userId: string;
  }): Promise<{ content: string; finish_reason: string }>;

  extractSectionRecord(req: {
    section_id: string;
    section_index: number;
    section_title: string;
    section_content: string;
    existing_terms: string[];
    model: string;
    userId: string;
  }): Promise<{ record: SectionRecord }>;
}
