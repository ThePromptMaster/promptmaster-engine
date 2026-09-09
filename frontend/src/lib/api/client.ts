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
  ApplyRecommendationsRequest,
  ApplyRecommendationsResponse,
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

async function rawFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
      ...options?.headers,
    },
  });
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await rawFetch(path, options);

  // An expired token is the common case and is silently recoverable; retry once.
  if (res.status === 401 && (await refreshSessionOnce())) {
    res = await rawFetch(path, options);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw toApiError(body, res.status);
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

  /**
   * Apply accepted recommendations to a stage's artifact. 1 LLM call. FR-09.
   *
   * Deliberately not `applyAudit`, which runs the four-call iteration pipeline
   * and scores the result against `inputs.objective` — the wrong bar for a
   * stage artifact, and three discarded results.
   *
   * Interruptible for the same reason drafting and evaluation are: a response
   * landing on a stage the user has left is worse than no response.
   */
  async applyRecommendations(
    req: ApplyRecommendationsRequest,
    signal?: AbortSignal
  ): Promise<ApplyRecommendationsResponse> {
    return apiFetch('/api/apply-recommendations', {
      method: 'POST',
      body: JSON.stringify(req),
      signal,
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
