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
  SectionRevisionBrief,
} from './types';
import type { PMInput } from '@/types';
import { USAGE_HEADER, parseUsageHeader } from '@/lib/observability/usage';
import { stepRequestId } from './log';

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

/** One provider call the drain paid for, ready to be written to `model_usage`. */
export interface DrainUsage {
  userId: string;
  projectId: string | null;
  requestId: string;
  route: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  promptPriceUsd: number | null;
  completionPriceUsd: number | null;
}

/** Headroom kept back from the backend's budget for the response to travel. */
const RESPONSE_HEADROOM_MS = 5_000;

export class HttpSectionGenerator implements SectionGenerator {
  constructor(
    private workerSecret: string,
    private timeoutMs = 150_000
  ) {}

  /**
   * How long the next call may take, set by the drain before each step (PM-04).
   *
   * The timeout used to be a fixed 90s inside a 60s function, so it could never
   * fire first: a slow chapter was killed by the platform mid-call, the prose
   * already paid for was lost, the lease expired, and after three rounds the
   * job was buried as "gave up". Now a call never outlives the function, and
   * the backend is told the same budget so its retry ladder stops in time.
   */
  private budgetMs: number | null = null;

  setTimeBudget(ms: number): void {
    this.budgetMs = Math.max(0, ms);
  }

  private callTimeoutMs(): number {
    return this.budgetMs === null ? this.timeoutMs : Math.min(this.timeoutMs, this.budgetMs);
  }

  /**
   * Which job and project the next calls belong to.
   *
   * Set by the drain before each job. Mutable state on the generator rather
   * than an extra argument on both methods, for the same reason `spent` is a
   * field: the `SectionGenerator` interface describes generation, and threading
   * attribution through it would make every implementation — including the test
   * double — carry telemetry plumbing it has no use for.
   */
  private jobId: string | null = null;
  private projectId: string | null = null;

  attributeTo(jobId: string, projectId: string | null): void {
    this.jobId = jobId;
    this.projectId = projectId;
  }

  /** Never throws: metering must not be able to fail a section. */
  private captureUsage(res: Response, path: string, requestId: string, userId: string): void {
    try {
      const events = parseUsageHeader(res.headers?.get(USAGE_HEADER) ?? null);
      for (const event of events) {
        this.spent.push({
          userId,
          projectId: this.projectId,
          requestId,
          route: path,
          model: event.model,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          costUsd: event.costUsd,
          promptPriceUsd: event.promptPriceUsd,
          completionPriceUsd: event.completionPriceUsd,
        });
      }
    } catch {
      // Swallowed by design.
    }
  }

  /**
   * FR-18/FR-19: what the drain spent, and under which correlation id.
   *
   * Populated on every call and read by the drain route, which persists the
   * usage rows with `source: 'drain'`. It is a field rather than a return value
   * because `SectionGenerator` is an interface with a test double behind it,
   * and widening every method's return type to carry telemetry would push
   * bookkeeping into the contract that describes generation.
   */
  readonly spent: DrainUsage[] = [];

  private async post<T>(path: string, body: unknown, userId: string): Promise<T> {
    // A hung provider must not hold the function open until the platform kills
    // it: that would burn the whole budget and leave the lease to expire, which
    // costs the user a lease interval of apparent stall.
    const controller = new AbortController();
    const timeoutMs = this.callTimeoutMs();
    const cappedByBudget = timeoutMs < this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const budgetSeconds = Math.max(1, Math.floor((timeoutMs - RESPONSE_HEADROOM_MS) / 1000));

    // FR-19. The backend adopts this rather than minting its own, so this one
    // string ties the drain's log line, the API's log lines, and the usage rows
    // for the call together.
    const requestId = stepRequestId(this.jobId ?? 'nojob', path);

    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.workerSecret}`,
          'X-PromptMaster-User': userId,
          'X-Request-Id': requestId,
          ...(this.projectId ? { 'X-PromptMaster-Project': this.projectId } : {}),
        },
        body: JSON.stringify({ ...(body as object), budget_seconds: budgetSeconds }),
        signal: controller.signal,
      });

      // Read usage before the ok-check: a call can fail after spending. The
      // header is absent on most failures, so this is normally a no-op.
      this.captureUsage(res, path, requestId, userId);

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const detail = payload?.detail;
        // The backend's error body is structured — {code, title, message, ...}
        // (routers/_errors.py). Only the string form used to be read, so every
        // failure arrived here code-less and was classified by HTTP status: a
        // 502 wrapping "out of credits" became "provider unavailable, retry",
        // and a non-retryable error was retried until the job was buried.
        if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
          throw new GeneratorError(
            String(detail.message || detail.title || `API error: ${res.status}`),
            res.status,
            detail.code
          );
        }
        throw new GeneratorError(
          typeof detail === 'string' ? detail : `API error: ${res.status}`,
          res.status
        );
      }
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof GeneratorError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        // Stopping because this run is out of time is a pause, not a failure:
        // the drain hands the job back without spending an attempt.
        throw new GeneratorError(
          `Generation timed out after ${timeoutMs}ms`,
          504,
          cappedByBudget ? 'function_timeout' : undefined
        );
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
    revision?: SectionRevisionBrief;
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
        ...(req.revision ? { revision: req.revision } : {}),
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
