/**
 * The drain's client for FastAPI — the only thing it asks the backend for.
 *
 * Two calls, both pure generation, neither of which touches persistence. That
 * split is the settled architecture: the drain owns Supabase, the backend owns
 * the model, and neither reaches into the other. It is why `generate_section`
 * was split into `generate-section-prose` and `extract-section-record` rather
 * than being called as one endpoint that does both.
 *
 * Authentication is the worker credential, not a user token. Under Vercel Cron
 * there is no user in the request, and a job outlives an access token anyway —
 * a book queued at 4pm may still be draining at 6pm. `X-PromptMaster-User`
 * names who the work is for so the backend can still meter it per user.
 */

import type {
  OutlineSectionState,
  SectionGenerator,
  SectionRecord,
} from './types';
import type { PMInput } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** An API failure that keeps the status, so the taxonomy can classify it. */
export class GeneratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'GeneratorError';
  }
}

export class HttpSectionGenerator implements SectionGenerator {
  constructor(
    private workerSecret: string,
    private timeoutMs = 90_000
  ) {}

  private async post<T>(path: string, body: unknown, userId: string): Promise<T> {
    // A hung provider must not hold the function open until the platform kills
    // it: that would burn the whole budget and leave the lease to expire, which
    // costs the user a lease interval of apparent stall.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.workerSecret}`,
          'X-PromptMaster-User': userId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const detail =
          payload && typeof payload.detail === 'string'
            ? payload.detail
            : `API error: ${res.status}`;
        throw new GeneratorError(detail, res.status);
      }
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof GeneratorError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GeneratorError(`Generation timed out after ${this.timeoutMs}ms`, 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateSectionProse(req: {
    inputs: PMInput;
    outline: OutlineSectionState[];
    section_index: number;
    records: SectionRecord[];
    prev_section_content: string;
    model: string;
    userId: string;
  }): Promise<{ content: string; finish_reason: string }> {
    return this.post(
      '/api/generate-section-prose',
      {
        inputs: req.inputs,
        outline: req.outline,
        section_index: req.section_index,
        records: req.records,
        prev_section_content: req.prev_section_content,
        model: req.model,
      },
      req.userId
    );
  }

  async extractSectionRecord(req: {
    section_id: string;
    section_index: number;
    section_title: string;
    section_content: string;
    existing_terms: string[];
    model: string;
    userId: string;
  }): Promise<{ record: SectionRecord }> {
    return this.post(
      '/api/extract-section-record',
      {
        section_id: req.section_id,
        section_index: req.section_index,
        section_title: req.section_title,
        section_content: req.section_content,
        existing_terms: req.existing_terms,
        model: req.model,
      },
      req.userId
    );
  }
}
