"""Data contracts for PromptMaster Engine."""

from typing import Literal
from datetime import datetime, timezone
from uuid import uuid4
from pydantic import BaseModel, Field

ModeType = Literal["architect", "critic", "clarity", "coach", "therapist", "cold_critic", "analyst", "custom"]
ScoreLevel = Literal["Low", "Medium", "High"]


class PMInput(BaseModel):
    """User inputs for a PromptMaster session."""
    objective: str = Field(..., description="What the user wants to accomplish")
    audience: str = Field(default="General", description="Target audience")
    constraints: str = Field(default="", description="Optional constraints")
    output_format: str = Field(default="", description="Desired output structure (e.g. bullet points, numbered list)")
    mode: ModeType = Field(..., description="Selected operational mode")
    # Custom mode fields (only used when mode == 'custom')
    custom_name: str = Field(default="", description="Custom mode persona name")
    custom_preamble: str = Field(default="", description="Custom mode system preamble")
    custom_tone: str = Field(default="", description="Custom mode tone")
    # Session Facts (Information Anchors, Ch5 S5) — pinned facts that anchor
    # the conversation's knowledge and get injected into every prompt.
    session_facts: list[str] = Field(default_factory=list, description="Pinned facts that anchor the session")


class AssembledPrompt(BaseModel):
    """Fully assembled prompt ready for LLM execution."""
    system_prompt: str = Field(..., description="System prompt with mode lock + scaffolding")
    user_prompt: str = Field(..., description="User-facing prompt with objective + context")
    scaffolding_notes: str = Field(default="", description="Internal scaffolding (hidden by default)")


class DimensionScore(BaseModel):
    """Score for a single evaluation dimension."""
    score: ScoreLevel = Field(..., description="Low, Medium, or High")
    explanation: str = Field(default="", description="One-sentence explanation")


class CompletenessResult(BaseModel):
    """Structural completeness judgment for an iteration's output."""
    status: Literal["complete", "incomplete"]
    reason: str = Field(default="", description="Short explanation when incomplete.")


class WhyThisWorks(BaseModel):
    """Plain-language interpretation of an output's eval.

    Label flips between 'Why this works' (positive framing) and
    'What to improve' (negative framing) based on the LLM's overall judgment.
    """
    label: Literal["Why this works", "What to improve"]
    bullets: list[str] = Field(default_factory=list, description="3-4 short bullets in plain English.")


class AuditFinding(BaseModel):
    """One actionable audit finding produced by /api/audit-findings."""
    id: str = Field(..., description="Unique within a findings list.")
    category: str = Field(..., description="Short tag, e.g., 'Coverage', 'Clarity', 'Tone'.")
    summary: str = Field(..., description="One line — what's wrong.")
    suggested_change: str = Field(..., description="One line — what to do about it.")


class EvaluationResult(BaseModel):
    """Result from the evaluator LLM call."""
    alignment: DimensionScore = Field(..., description="Does output match the stated objective?")
    drift: DimensionScore = Field(..., description="Does output introduce irrelevant content?")
    clarity: DimensionScore = Field(..., description="Is the output structured and unambiguous?")
    completeness: CompletenessResult | None = Field(
        default=None,
        description="Structural completeness — set by extended eval call. Optional for backward compat.",
    )
    interpretation: WhyThisWorks | None = Field(
        default=None,
        description="Plain-language 3-4 bullet summary of why the output works or what to improve.",
    )

    @property
    def needs_realignment(self) -> bool:
        """Realignment triggers if Alignment < Medium OR Drift > Medium."""
        return self.alignment.score == "Low" or self.drift.score == "High"


class Iteration(BaseModel):
    """Record of a single generate-evaluate cycle."""
    iteration_number: int = Field(..., ge=1)
    prompt_sent: str = Field(..., description="The prompt text sent to LLM")
    system_prompt_used: str = Field(default="", description="System prompt used")
    output: str = Field(..., description="LLM response text")
    mode: ModeType = Field(...)
    evaluation: EvaluationResult | None = Field(default=None)
    trigger_source: str | None = Field(
        default=None,
        description="Where this iteration came from: 'initial', 'refine', 'realignment', 'challenge', 'self_audit', 'drift_alert', 'refine_shorter', etc.",
    )
    user_rating: Literal["positive", "negative"] | None = Field(
        default=None,
        description="User's explicit rating of this iteration — 'positive' (strong) or 'negative' (poor), or None if unrated.",
    )
    summary: str | None = Field(
        default=None,
        description="Brief LLM-generated summary of what changed from the previous version. None for the first iteration.",
    )
    continuity_snapshot: "ContinuitySnapshot | None" = Field(
        default=None,
        description="Snapshot used to build this iteration's continuation prompt. Set on continuation iterations only.",
    )
    created_at: str = Field(
        default="",
        description="ISO-8601 UTC timestamp of when this version was produced (FR-10).",
    )
    model_used: str = Field(
        default="",
        description="Model that produced this version. Per-version, unlike Session.model (FR-10).",
    )
    instruction: str = Field(
        default="",
        description="The instruction or recommendation that produced this version, if any (FR-10).",
    )


class PromptTemplate(BaseModel):
    """A reusable prompt template (Book Ch7 S2)."""
    template_id: str = Field(default_factory=lambda: uuid4().hex[:8])
    name: str = Field(..., description="User-friendly template name")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    mode: ModeType = Field(...)
    audience: str = Field(default="General")
    constraints: str = Field(default="")
    output_format: str = Field(default="")
    objective_hint: str = Field(default="", description="Optional objective template/placeholder text")
    # Custom mode fields (only used when mode == 'custom')
    custom_name: str = Field(default="")
    custom_preamble: str = Field(default="")
    custom_tone: str = Field(default="")


class Session(BaseModel):
    """A complete PromptMaster session for persistence."""
    session_id: str = Field(default_factory=lambda: uuid4().hex[:8])
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    objective: str
    audience: str = "General"
    constraints: str = ""
    output_format: str = ""
    mode: ModeType
    model: str = ""
    iterations: list[Iteration] = Field(default_factory=list)
    finalized: bool = False


class ChatMessage(BaseModel):
    """A single message in a per-iteration chat thread."""
    id: str = Field(..., description="UUID")
    iteration_number: int = Field(..., ge=1, description="Which iteration this chat belongs to")
    role: Literal["user", "assistant"] = Field(...)
    content: str = Field(...)
    created_at: str = Field(..., description="ISO 8601 timestamp")


class ContinuitySnapshot(BaseModel):
    """Snapshot of progress used to build a continuation prompt.

    Generated lazily when the user clicks Continue Document.
    Stored on the resulting continuation iteration for inspection.
    """
    completed_topics: list[str] = Field(default_factory=list, description="Short phrases naming each section/topic already covered.")
    current_topic: str | None = Field(default=None, description="Where the previous output trails off, if mid-section.")
    key_definitions: list[str] = Field(default_factory=list, description="Terms or constraints established earlier that the continuation must respect.")
    next_topic_hint: str | None = Field(default=None, description="What to write next, if the structure makes it obvious.")


class OutlineSection(BaseModel):
    """One section in a document outline for long-form generation."""
    id: str
    title: str
    abstract: str = Field(default="", description="One-sentence description of what this section covers.")
    status: Literal["pending", "writing", "complete", "error"] = "pending"
    content: str = ""
    revision: int = 0
    finish_reason: str | None = None
    error: str | None = None
    generated_at: str | None = None


class LongFormState(BaseModel):
    """Tracks progress through long-form document generation."""
    state: Literal["outlining", "review_outline", "writing", "paused", "complete"]
    current_section_index: int = -1
    outline: list[OutlineSection] = Field(default_factory=list)
    continuity_snapshot: ContinuitySnapshot | None = None
    started_at: str
    completed_at: str | None = None


class DetectLongFormResponse(BaseModel):
    """Response from long-form detection call."""
    is_long_form: bool
    suggested_section_count: int = 0
    reason: str = ""


class GenerateOutlineResponse(BaseModel):
    """Response from outline generation call."""
    outline: list[OutlineSection]


class GenerateSectionResponse(BaseModel):
    """Response from section content generation call."""
    content: str
    finish_reason: str
    new_snapshot: ContinuitySnapshot


# Resolve forward reference for Iteration.continuity_snapshot
Iteration.model_rebuild()


class SetupRationale(BaseModel):
    """One-line 'why this' explanations for each suggested field."""
    mode: str = Field(default="")
    audience: str = Field(default="")
    constraints: str = Field(default="")
    output_format: str = Field(default="")


class SetupSuggestion(BaseModel):
    """Suggested PMInput fields produced by the Smart Setup LLM call."""
    mode: ModeType
    audience: str
    constraints: str
    output_format: str
    rationale: SetupRationale = Field(default_factory=SetupRationale)
