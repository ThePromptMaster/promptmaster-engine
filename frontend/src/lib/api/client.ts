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
  GenerateStageArtifactRequest,
  GenerateStageArtifactResponse,
} from '@/types';
import { createClient } from '@/lib/supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** An API failure that carries the HTTP status, so callers can branch on 401. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
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
    const detail =
      typeof body?.detail === 'string' ? body.detail : `API error: ${res.status}`;
    throw new ApiError(detail, res.status);
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
