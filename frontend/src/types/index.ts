export type ModeType = 'architect' | 'critic' | 'clarity' | 'coach' | 'therapist' | 'cold_critic' | 'analyst' | 'custom';
export type ScoreLevel = 'Low' | 'Medium' | 'High';
export type Phase = 'input' | 'review' | 'output' | 'realign' | 'summary';

export interface PMInput {
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;
  mode: ModeType;
  custom_name?: string;
  custom_preamble?: string;
  custom_tone?: string;
  session_facts?: string[];
}

export interface AssembledPrompt {
  system_prompt: string;
  user_prompt: string;
  scaffolding_notes: string;
}

export interface DimensionScore {
  score: ScoreLevel;
  explanation: string;
}

export interface CompletenessResult {
  status: 'complete' | 'incomplete';
  reason: string;
}

export interface EvaluationResult {
  alignment: DimensionScore;
  drift: DimensionScore;
  clarity: DimensionScore;
  completeness?: CompletenessResult | null;
  interpretation?: WhyThisWorks | null;
}

export type UserRating = 'positive' | 'negative';

export interface ContinuitySnapshot {
  completed_topics: string[];
  current_topic: string | null;
  key_definitions: string[];
  next_topic_hint: string | null;
}

export interface OutlineSection {
  id: string;
  title: string;
  abstract: string;
  status: 'pending' | 'writing' | 'complete' | 'error';
  content: string;
  revision: number;
  finish_reason: string | null;
  error: string | null;
  generated_at: string | null;
  /**
   * FR-07: the approved outline this section was written against.
   *
   * `write_long_form_section` has stamped it since the job writes landed; it
   * was simply absent from this type, which is why the outline editor could not
   * tell which prose was written against a superseded outline.
   */
  outline_version_id?: string | null;
}

export type LongFormStateName =
  | 'outlining'
  | 'review_outline'
  | 'writing'
  | 'paused'
  | 'complete';

export interface LongFormState {
  state: LongFormStateName;
  current_section_index: number;
  outline: OutlineSection[];
  continuity_snapshot: ContinuitySnapshot | null;
  started_at: string;
  completed_at: string | null;
}

export interface DetectLongFormResponse {
  is_long_form: boolean;
  suggested_section_count: number;
  reason: string;
}

export interface GenerateOutlineResponse {
  outline: OutlineSection[];
}

export interface GenerateSectionResponse {
  content: string;
  finish_reason: string;
  new_snapshot: ContinuitySnapshot;
}

export interface Iteration {
  iteration_number: number;
  prompt_sent: string;
  system_prompt_used: string;
  output: string;
  mode: ModeType;
  evaluation: EvaluationResult | null;
  trigger_source?: string | null;
  user_rating?: UserRating | null;
  summary?: string | null;
  continuity_snapshot?: ContinuitySnapshot | null;
}

export interface PromptTemplate {
  template_id: string;
  name: string;
  created_at: string;
  mode: ModeType;
  audience: string;
  constraints: string;
  output_format: string;
  objective_hint: string;
  custom_name: string;
  custom_preamble: string;
  custom_tone: string;
}

export interface Session {
  session_id: string;
  created_at: string;
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;
  mode: ModeType;
  model: string;
  iterations: Iteration[];
  finalized: boolean;
  long_form?: LongFormState | null;
}

export interface ModeConfig {
  display_name: string;
  tagline: string;
  tone: string;
}

export interface SessionSummary {
  session_id: string;
  objective: string;
  mode: string;
  iterations: number;
  created_at: string;
  finalized: boolean;
}

export interface TemplateSummary {
  template_id: string;
  name: string;
  mode: string;
  audience: string;
  created_at: string;
}

// Flow Trigger types — book concepts from Ch1 S13-S14, Ch4 S10, Ch6 S3
export type FlowTriggerType =
  | 'challenge'
  | 'self_audit'
  | 'reframe'
  | 'drift_alert'
  | 'refine_shorter'
  | 'refine_technical'
  | 'refine_concrete'
  | 'refine_angle'
  | 'refine_cautious';

export type FlowInspectType =
  | 'check_intent'
  | 'confirm_understanding'
  | 'analyze_pattern'
  | 'ask_questions';

export type FlowInspectResult =
  | { kind: 'check_intent'; text: string }
  | { kind: 'confirm_understanding'; text: string }
  | { kind: 'analyze_pattern'; text: string }
  | { kind: 'ask_questions'; questions: string[] };

// --- Chat / conversation types ---

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  iteration_number: number;
  role: ChatRole;
  content: string;
  created_at: string;
}

export interface ChatMessageRequest {
  inputs: PMInput;
  active_iteration: Iteration;
  chat_history: ChatMessage[];
  user_message: string;
  iteration_history?: Iteration[];
  model?: string;
}

export interface ChatMessageResponse {
  assistant_message: ChatMessage;
}

export interface ApplyToAnswerRequest {
  inputs: PMInput;
  active_iteration: Iteration;
  chat_history: ChatMessage[];
  iteration_number: number;
  iteration_history?: Iteration[];
  model?: string;
}

export interface SaveAsNewVersionRequest {
  inputs: PMInput;
  active_iteration: Iteration;
  chat_history: ChatMessage[];
  iteration_number: number;
  iteration_history?: Iteration[];
  model?: string;
}

export interface IterationFromConversationResponse {
  iteration: Iteration;
  suggestions: string[];
}

export interface ContinueDocumentRequest {
  inputs: PMInput;
  incomplete_iteration: Iteration;
  iteration_number: number;
  iteration_history?: Iteration[];
  model?: string;
}

// --- Smart Setup types ---

export interface SetupRationale {
  mode: string;
  audience: string;
  constraints: string;
  output_format: string;
}

export interface SetupSuggestion {
  mode: ModeType;
  audience: string;
  constraints: string;
  output_format: string;
  rationale: SetupRationale;
}

export interface GenerateSetupRequest {
  objective: string;
  model?: string;
}

export interface GenerateSetupResponse {
  suggestion: SetupSuggestion;
}

// --- Output Polish types ---

export interface WhyThisWorks {
  label: 'Why this works' | 'What to improve';
  bullets: string[];
}

export interface AuditFinding {
  id: string;
  category: string;
  summary: string;
  suggested_change: string;
}

export interface AuditFindingsRequest {
  inputs: PMInput;
  current_output: string;
  iteration_history?: Iteration[];
  model?: string;
}

export interface AuditFindingsResponse {
  findings: AuditFinding[];
}

export interface ApplyAuditRequest {
  inputs: PMInput;
  source_iteration: Iteration;
  findings: AuditFinding[];
  iteration_number: number;
  iteration_history?: Iteration[];
  model?: string;
}

// --- Custom Modes ---

export interface CustomMode {
  id: string;
  user_id?: string;
  name: string;
  preamble: string;
  tone: string;
  created_at: string;
  updated_at: string;
}

export interface CustomModeInput {
  name: string;
  preamble: string;
  tone: string;
}

// --- Stage artifacts (POST /api/generate-stage-artifact) ---
//
// Mirrors backend/promptmaster/schemas.py. One request shape covers every
// stage of every workflow: the difference between an Audience stage and a
// fact-check stage is the descriptor and the item schema, both of which are
// template data.

export interface StageDigestEntry {
  stage_id: string;
  label: string;
  summary: string;
}

export interface StageDigestRequest {
  objective: string;
  audience: string;
  prior_stages: StageDigestEntry[];
}

export interface StageDescriptorRequest {
  id: string;
  label: string;
  renderer: 'prose' | 'list' | 'outline' | 'long_form' | 'review';
  entry_prompt_hint: string;
  artifact_kind: string;
}

export interface StageItemSchemaRequest {
  item_label: string;
  fields: { key: string; label: string; hint?: string }[];
  min_items: number;
  max_items: number;
}

export interface GenerateStageArtifactRequest {
  inputs: PMInput;
  stage: StageDescriptorRequest;
  digest: StageDigestRequest;
  item_schema?: StageItemSchemaRequest | null;
  existing_content?: string;
  model?: string;
}

export interface GenerateStageArtifactResponse {
  content: string;
  /** Rows for list and review stages; the extra keys are schema-defined. */
  items: Record<string, string>[];
  finish_reason: string;
}
