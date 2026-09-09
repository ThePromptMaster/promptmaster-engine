import type {
  PMInput,
  AssembledPrompt,
  Iteration,
  EvaluationResult,
  ModeConfig,
  FlowTriggerType,
  FlowInspectType,
  FlowInspectResult,
  ChatMessage,
  ChatMessageRequest,
  ChatMessageResponse,
  ApplyToAnswerRequest,
  SaveAsNewVersionRequest,
  IterationFromConversationResponse,
  ContinueDocumentRequest,
  GenerateSetupRequest,
  GenerateSetupResponse,
  AuditFindingsRequest,
  AuditFindingsResponse,
  ApplyAuditRequest,
  ContinuitySnapshot,
  DetectLongFormResponse,
  GenerateOutlineResponse,
  GenerateSectionResponse,
  OutlineSection,
  EvaluateStageArtifactRequest,
  EvaluateStageArtifactResponse,
  GenerateStageArtifactRequest,
  GenerateStageArtifactResponse,
} from '@/types';
import { createClient } from '@/lib/supabase/client';
import {
  REQUEST_ID_HEADER,
  USAGE_HEADER,
  parseUsageHeader,
} from '@/lib/observability/usage';
import {
  currentUsageProject,
  recordErrorEvent,
  recordModelUsage,
} from '@/lib/supabase/model-usage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** FR-18: the pre-flight answer to "is this a large job?". Mirrors `EstimateJobResponse`. */
export interface JobEstimate {
  section_count: number;
  llm_calls: number;
  estimated_tokens_in: number;
  estimated_tokens_out: number;
  /** null when the model's price is unknown. Render as "cost unknown", not $0. */
  estimated_cost_usd: number | null;
  is_large: boolean;
  /** The sentence to show. Written server-side so copy and threshold cannot drift. */
  warning: string | null;
}

/**
 * An API failure that carries the HTTP status, so callers can branch on 401 —
 * and, since FR-16, the backend's classification of what actually went wrong.
 *
 * `message` is the plain-language recovery sentence when the server classified
 * the failure, and the raw detail string when it did not. `technical` is the
 * unvarnished cause, which is what the "view technical details" disclosure
 * shows; it is deliberately never the thing rendered by default.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly title?: string;
  readonly retryable?: boolean;
  readonly retryAfter?: number | null;
  readonly technical?: string;
  readonly providerStatus?: number | null;

  constructor(
    message: string,
    readonly status: number,
    classified?: {
      code?: string;
      title?: string;
      retryable?: boolean;
      retryAfter?: number | null;
      technical?: string;
      providerStatus?: number | null;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, classified ?? {});
  }
}

/**
 * FastAPI serialises `detail` verbatim, so it arrives as either the legacy
 * string or the FR-16 object. Reading both keeps a client deployed ahead of
 * the backend — or behind it — working rather than showing "API error: 502".
 */
function toApiError(body: unknown, status: number): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    const message =
      typeof d.message === 'string' && d.message
        ? d.message
        : typeof d.detail === 'string'
          ? d.detail
          : `API error: ${status}`;
    return new ApiError(message, status, {
      code: typeof d.code === 'string' ? d.code : undefined,
      title: typeof d.title === 'string' ? d.title : undefined,
      retryable: typeof d.retryable === 'boolean' ? d.retryable : undefined,
      retryAfter: typeof d.retry_after === 'number' ? d.retry_after : null,
      technical: typeof d.detail === 'string' ? d.detail : undefined,
      providerStatus: typeof d.provider_status === 'number' ? d.provider_status : null,
    });
  }

  return new ApiError(
    typeof detail === 'string' ? detail : `API error: ${status}`,
    status
  );
}

/**
 * getSession() reads the locally cached session; getUser() would make a network
 * round-trip to Supabase on every one of the ~20 API methods. supabase-js
 * refreshes in the background, so the cached token is normally fresh.
 */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await createClient().auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Never block a request on an auth-layer failure; the backend decides.
    return {};
  }
}

/**
 * Single-flight refresh. Without this, twenty parallel calls that all 401 fire
 * twenty refreshes and race each other into a revoked-refresh-token loop.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const { data, error } = await createClient().auth.refreshSession();
    return Boolean(data.session) && !error;
  } catch {
    return false;
  }
}

function refreshSessionOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    const pending = doRefresh().finally(() => {
      refreshInFlight = null;
    });
    refreshInFlight = pending;
    return pending;
  }
  return refreshInFlight;
}

/**
 * FR-19: one id, followed across the client, the API, and the drain.
 *
 * Generated here rather than server-side so that a request which never arrives
 * — a network failure, a CORS rejection, a cold-start timeout — still has an id
 * to report. The backend adopts an inbound `X-Request-Id` rather than minting
 * its own, so this is the id that appears in its log lines and on the
 * `model_usage` row.
 */
function newRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    // `crypto.randomUUID` needs a secure context. Correlation is not security,
    // so a weaker id here is fine; having none is not.
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function rawFetch(
  path: string,
  options: RequestInit | undefined,
  requestId: string
): Promise<Response> {
  const projectId = currentUsageProject();
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
      // Attribution only — the backend uses it to tag its log lines. It is not
      // an authorisation input on either side, and it is absent outside a
      // project, which is a real and expected state.
      ...(projectId ? { 'X-PromptMaster-Project': projectId } : {}),
      ...(await authHeader()),
      ...options?.headers,
    },
  });
}

/**
 * Read one response header without ever throwing.
 *
 * A `Response` from the platform always has `headers`, but this is the only
 * thing standing between a stubbed or exotic response object and a request path
 * that dies on telemetry. The whole design commitment is that metering can lose
 * a row but must never lose a generation, and that commitment is worth four
 * lines rather than an assumption.
 */
function header(res: Response, name: string): string | null {
  try {
    return res.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * FR-18: persist what the request spent, off the response header.
 *
 * Deliberately not awaited by the caller. Metering is bookkeeping attached to a
 * response the user is already looking at; making them wait on an insert to see
 * their own generation would be the wrong trade in every case. Failures inside
 * are swallowed by `recordModelUsage` itself.
 */
function meter(res: Response, path: string, requestId: string): void {
  const events = parseUsageHeader(header(res, USAGE_HEADER));
  if (events.length === 0) return;
  void recordModelUsage(events, { route: path, requestId });
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const requestId = newRequestId();
  let res = await rawFetch(path, options, requestId);

  // An expired token is the common case and is silently recoverable; retry once.
  if (res.status === 401 && (await refreshSessionOnce())) {
    // A retry is a second billable request, so it carries a second id rather
    // than reusing the first — otherwise two sets of usage rows would collapse
    // onto one correlation id and the log would show one request that somehow
    // spent twice.
    meter(res, path, requestId);
    res = await rawFetch(path, options, newRequestId());
  }

  // Read usage before branching on `ok`: a request can fail *after* spending
  // money. A stage generation whose evaluation call 502s has already paid for
  // the generation, and that is exactly the spend an operator needs to see.
  meter(res, path, header(res, REQUEST_ID_HEADER) ?? requestId);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const error = toApiError(body, res.status);
    void recordErrorEvent({
      code: error.code ?? 'unknown',
      title: error.title ?? '',
      message: error.message,
      technical: error.technical,
      route: path,
      requestId: header(res, REQUEST_ID_HEADER) ?? requestId,
      httpStatus: res.status,
    });
    throw error;
  }
  return res.json();
}

export const api = {
  async buildPrompt(inputs: PMInput): Promise<AssembledPrompt> {
    return apiFetch('/api/build-prompt', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
  },

  async runIteration(req: {
    inputs: PMInput;
    prompt_text: string;
    system_text: string;
    iteration_number: number;
    iteration_history?: Iteration[];
    source?: string;
    model?: string;
  }): Promise<{ iteration: Iteration; suggestions: string[] }> {
    return apiFetch('/api/run-iteration', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async buildRealignment(req: {
    inputs: PMInput;
    evaluation: EvaluationResult;
    iteration_history?: Iteration[];
    model?: string;
  }): Promise<{ realignment_prompt: string }> {
    return apiFetch('/api/build-realignment', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async flowTrigger(req: {
    inputs: PMInput;
    current_output: string;
    trigger: FlowTriggerType;
    iteration_number: number;
    evaluation?: EvaluationResult | null;
    iteration_history?: Iteration[];
    model?: string;
  }): Promise<{ iteration: Iteration; suggestions: string[] }> {
    return apiFetch('/api/flow-trigger', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async flowInspect(req: {
    inputs: PMInput;
    current_output: string;
    inspection: FlowInspectType;
    iteration_history?: Iteration[];
    model?: string;
  }): Promise<FlowInspectResult> {
    return apiFetch('/api/flow-inspect', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async chatMessage(req: ChatMessageRequest): Promise<ChatMessageResponse> {
    return apiFetch('/api/chat-message', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async applyToAnswer(req: ApplyToAnswerRequest): Promise<IterationFromConversationResponse> {
    return apiFetch('/api/apply-to-answer', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async saveAsNewVersion(req: SaveAsNewVersionRequest): Promise<IterationFromConversationResponse> {
    return apiFetch('/api/save-as-new-version', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async continueDocument(req: ContinueDocumentRequest): Promise<IterationFromConversationResponse> {
    return apiFetch('/api/continue-document', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  /**
   * FR-18: what a drafting run will cost, before it is enqueued.
   *
   * Makes no LLM call — it is arithmetic over the backend's own limits plus the
   * live OpenRouter price. A warning that costs a model call to produce, or
   * that arrives after a round-trip the user will not wait through, is a
   * warning nobody sees.
   */
  async estimateJob(req: { section_count: number; model?: string }): Promise<JobEstimate> {
    return apiFetch('/api/estimate-job', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async detectLongForm(req: { inputs: PMInput; model?: string }): Promise<DetectLongFormResponse> {
    return apiFetch('/api/detect-long-form', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async generateOutline(req: {
    inputs: PMInput;
    suggested_section_count: number;
    model?: string;
  }): Promise<GenerateOutlineResponse> {
    return apiFetch('/api/generate-outline', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async generateSection(req: {
    inputs: PMInput;
    outline: OutlineSection[];
    section_index: number;
    prior_snapshot: ContinuitySnapshot | null;
    prev_section_content: string;
    model?: string;
  }): Promise<GenerateSectionResponse> {
    return apiFetch('/api/generate-section', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async finalizeLongForm(req: {
    inputs: PMInput;
    merged_content: string;
    outline: OutlineSection[];
    iteration_number: number;
    iteration_history: Iteration[];
    model?: string;
  }): Promise<IterationFromConversationResponse> {
    return apiFetch('/api/finalize-long-form', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  /**
   * Draft one stage's artifact. 1 LLM call.
   *
   * One method for all five renderers and both workflows — the stage
   * descriptor and item schema carry the difference, so adding a workflow
   * never adds a call site here.
   */
  async generateStageArtifact(
    req: GenerateStageArtifactRequest,
    signal?: AbortSignal
  ): Promise<GenerateStageArtifactResponse> {
    return apiFetch('/api/generate-stage-artifact', {
      method: 'POST',
      body: JSON.stringify(req),
      // Drafting has to be interruptible: a user who navigates away mid-draft
      // must not have a stale response land on the stage they moved to.
      signal,
    });
  },

  /**
   * Evaluate one stage's artifact. 1 LLM call. FR-11, FR-12.
   *
   * User-triggered rather than automatic on generation: the product decision
   * is that the cost is visible and chosen. Interruptible for the same reason
   * drafting is — a response landing on a stage the user has left is worse
   * than no response.
   */
  async evaluateStageArtifact(
    req: EvaluateStageArtifactRequest,
    signal?: AbortSignal
  ): Promise<EvaluateStageArtifactResponse> {
    return apiFetch('/api/evaluate-stage-artifact', {
      method: 'POST',
      body: JSON.stringify(req),
      signal,
    });
  },

  async generateSetup(req: GenerateSetupRequest): Promise<GenerateSetupResponse> {
    return apiFetch('/api/generate-setup', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async auditFindings(req: AuditFindingsRequest): Promise<AuditFindingsResponse> {
    return apiFetch('/api/audit-findings', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async applyAudit(req: ApplyAuditRequest): Promise<IterationFromConversationResponse> {
    return apiFetch('/api/apply-audit', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async runSelfAudit(req: {
    inputs: PMInput;
    iterations: Iteration[];
    model?: string;
  }): Promise<{ audit: string }> {
    return apiFetch('/api/run-self-audit', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async hardResetLessons(req: {
    inputs: PMInput;
    iterations: Iteration[];
    model?: string;
  }): Promise<{ lessons: string }> {
    return apiFetch('/api/hard-reset-lessons', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async formatSummary(req: {
    inputs: PMInput;
    iterations: Iteration[];
  }): Promise<{ summary: string }> {
    return apiFetch('/api/format-summary', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async exportSession(req: {
    inputs: PMInput;
    iterations: Iteration[];
    model?: string;
  }): Promise<{ json: string }> {
    return apiFetch('/api/export-session', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async getModels(): Promise<{ models: Array<{ id: string; name: string; context_length: number }> }> {
    return apiFetch('/api/models');
  },

  async getModes(): Promise<Record<string, ModeConfig>> {
    return apiFetch('/api/modes');
  },
};

export type { ChatMessage };
