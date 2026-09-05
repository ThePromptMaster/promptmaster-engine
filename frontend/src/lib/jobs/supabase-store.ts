/**
 * The real `JobStore`, over a service-role Supabase client.
 *
 * This module and the drain route handler are the only places in the app that
 * hold `SUPABASE_SERVICE_ROLE_KEY`, and it never reaches the browser — it is
 * read from a non-`NEXT_PUBLIC_` variable inside a route handler, so Next has no
 * way to inline it into a client bundle.
 *
 * Every method is an RPC against a SECURITY DEFINER function, not a table write.
 * The service role could bypass RLS and write `jobs` directly, but the functions
 * carry guarantees the caller cannot supply: claiming is atomic, lease-holder
 * writes are refused once the lease has moved on, and `workflow_events.seq` is
 * allocated inside the statement that consumes it.
 *
 * This is also why the backend stays stateless. The drain reads and writes
 * Supabase; FastAPI is asked only to generate.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  DraftCheckpoint,
  DraftSectionPayload,
  Job,
  JobStore,
  OutlineSectionState,
  SectionContext,
  SectionRecord,
  WriteSectionResult,
} from './types';

/** Only the tail of the previous section is used, for tone. See FR-06. */
const PREV_SECTION_TAIL_CHARS = 1500;

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'The drain needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseJobStore implements JobStore {
  constructor(private supabase: SupabaseClient) {}

  async reapExpiredLeases(): Promise<number> {
    const { data, error } = await this.supabase.rpc('reap_expired_leases');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  }

  async claimNextJob(
    worker: string,
    leaseSeconds: number,
    projectId?: string | null
  ): Promise<Job | null> {
    const { data, error } = await this.supabase.rpc('claim_next_job', {
      p_worker: worker,
      p_lease_seconds: leaseSeconds,
      p_project_id: projectId ?? null,
    });
    if (error) throw error;
    // `returns setof jobs` arrives as an array of zero or one row.
    const row = Array.isArray(data) ? data[0] : data;
    return (row as Job | undefined) ?? null;
  }

  async checkpointJob(
    jobId: string,
    worker: string,
    checkpoint: DraftCheckpoint,
    extendSeconds?: number
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('checkpoint_job', {
      p_job: jobId,
      p_worker: worker,
      p_checkpoint: checkpoint,
      p_extend_seconds: extendSeconds ?? null,
    });
    if (error) throw error;
    return data === true;
  }

  async completeJob(
    jobId: string,
    worker: string,
    result: Record<string, unknown>
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('complete_job', {
      p_job: jobId,
      p_worker: worker,
      p_result: result,
    });
    if (error) throw error;
    return data === true;
  }

  async failJob(
    jobId: string,
    worker: string,
    code: string,
    message: string,
    detail: Record<string, unknown>,
    retryable: boolean
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('fail_job', {
      p_job: jobId,
      p_worker: worker,
      p_error_code: code,
      p_error_message: message,
      p_error_detail: detail,
      p_retryable: retryable,
    });
    if (error) throw error;
    return data === true;
  }

  async releaseJob(jobId: string, worker: string, runAfterSeconds: number): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('release_job', {
      p_job: jobId,
      p_worker: worker,
      p_run_after_seconds: runAfterSeconds,
    });
    if (error) throw error;
    return data === true;
  }

  /**
   * Read exactly what the next prompt needs, and nothing more.
   *
   * Note what is absent: the document. Records come from `section_records` and
   * only the immediately previous section's tail is carried, so this read is
   * constant-size no matter how long the book has become.
   */
  async loadSectionContext(payload: DraftSectionPayload): Promise<SectionContext> {
    const [artifactResult, recordsResult] = await Promise.all([
      this.supabase
        .from('artifacts')
        .select('long_form')
        .eq('id', payload.artifact_id)
        .single(),
      this.supabase
        .from('section_records')
        .select('section_id, section_index, title, summary, glossary_terms, decisions, todos')
        .eq('project_id', payload.project_id)
        .lt('section_index', payload.section_index)
        .order('section_index', { ascending: true }),
    ]);

    if (artifactResult.error) throw artifactResult.error;
    if (recordsResult.error) throw recordsResult.error;

    const longForm = artifactResult.data?.long_form as
      | { outline?: OutlineSectionState[] }
      | null;
    const outline = Array.isArray(longForm?.outline) ? longForm.outline : [];

    // By id, never by index: the outline can be reordered between enqueue and
    // execution, and position 4 may no longer be the section this job is about.
    const section = outline.find((s) => s.id === payload.section_id) ?? null;

    const sectionIdx = outline.findIndex((s) => s.id === payload.section_id);
    const prev = sectionIdx > 0 ? outline[sectionIdx - 1] : null;
    const prevContent = prev?.content ?? '';

    return {
      outline,
      section,
      records: (recordsResult.data ?? []) as unknown as SectionRecord[],
      prevSectionContent:
        prevContent.length > PREV_SECTION_TAIL_CHARS
          ? prevContent.slice(-PREV_SECTION_TAIL_CHARS)
          : prevContent,
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
    const { data, error } = await this.supabase.rpc('write_long_form_section', {
      p_artifact_id: args.artifactId,
      p_worker: args.worker,
      p_section_id: args.sectionId,
      p_content: args.content,
      p_finish_reason: args.finishReason,
      p_outline_version_id: args.outlineVersionId,
      p_advance: true,
      p_event_type: 'section_written',
    });
    if (error) throw error;
    return data as WriteSectionResult;
  }

  async writeSectionRecord(args: {
    projectId: string;
    artifactId: string;
    outlineVersionId: string | null;
    record: SectionRecord;
  }): Promise<void> {
    const { error } = await this.supabase.rpc('write_section_record', {
      p_project_id: args.projectId,
      p_artifact_id: args.artifactId,
      p_section_id: args.record.section_id,
      p_section_index: args.record.section_index,
      p_title: args.record.title,
      p_summary: args.record.summary,
      p_glossary_terms: args.record.glossary_terms,
      p_decisions: args.record.decisions,
      p_todos: args.record.todos,
      p_outline_version_id: args.outlineVersionId,
    });
    if (error) throw error;
  }
}
