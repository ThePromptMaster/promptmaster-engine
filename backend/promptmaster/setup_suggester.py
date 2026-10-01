"""Smart Setup — LLM-driven suggestion of mode + audience + constraints + format.

Given a user's objective, returns a SetupSuggestion that pre-fills the Input
phase. Defensive parsing keeps the call resilient to malformed or partial
LLM responses — invalid mode falls back to 'architect', missing fields
default to safe values.
"""

from __future__ import annotations

import logging

from .llm_client import OpenRouterClient
from .schemas import GuideAnswer, GuideQuestion, ModeType, SetupRationale, SetupSuggestion

logger = logging.getLogger(__name__)


_VALID_MODES = {
    "architect", "critic", "clarity", "coach",
    "therapist", "cold_critic", "analyst",
}

_VALID_WORKFLOWS = {"book", "research", "single_output"}


SETUP_SUGGESTER_SYSTEM = (
    "You are the Smart Setup layer of PromptMaster. Given a user's objective, "
    "recommend the most fitting mode, audience, constraints, and output format "
    "to produce a high-quality structured response.\n\n"
    "Available modes:\n"
    "- architect: Structure, systems, frameworks\n"
    "- critic: Find weak points and contradictions\n"
    "- clarity: Make complex ideas simple and crisp\n"
    "- coach: Encouraging, action-oriented\n"
    "- therapist: Reflective, empathetic, exploratory\n"
    "- cold_critic: Brutally objective audit, no encouragement\n"
    "- analyst: Evidence-based, data-aware reasoning\n"
    "- custom: Reserved for user-defined modes — do NOT recommend custom\n\n"
    "Available audiences (suggest the closest match or a short free-text "
    "tailored to the objective):\n"
    "General, Technical, Executive, Academic, Student.\n\n"
    "Constraints: a short paragraph describing scope limits, focus areas, or "
    "deadlines. Be specific. If none apply, return an empty string.\n\n"
    "Output format: a short phrase describing structure (e.g., \"Numbered list "
    "with 3-5 items\", \"Two-section memo: Findings / Recommendations\", "
    "\"Markdown table\"). If none clearly apply, return \"Free-form prose\".\n\n"
    "Rationale: one line per field (≤80 chars) explaining why you picked it. "
    "Be brief and useful, not generic.\n\n"
    "Workflow: which PromptMaster workflow fits the objective.\n"
    "- book: long-form writing that has to hold together across chapters or "
    "sections — a book, a long report, a guide.\n"
    "- research: an investigation where the method matters as much as the "
    "result — a question to answer, a hypothesis to test, evidence to weigh.\n"
    "- single_output: one thing, done well, in one sitting — a memo, an email, "
    "an analysis, a plan, an answer.\n"
    "Pick the smallest workflow that fits; most everyday objectives are "
    "single_output. Give workflow_reason as one line (≤100 chars).\n\n"
    "Return JSON only."
)


def _format_answers(answers: list[GuideAnswer] | None) -> str:
    if not answers:
        return ""
    lines = [f"- {a.question.strip()} {a.answer.strip() or '(no answer)'}" for a in answers]
    return "What the user told us when asked:\n" + "\n".join(lines) + "\n\n"


def build_setup_prompt(objective: str, answers: list[GuideAnswer] | None = None) -> str:
    """Build the user prompt for the setup-suggestion LLM call."""
    return (
        f"Objective: {objective}\n\n"
        f"{_format_answers(answers)}"
        "Recommend a setup. Return JSON in this exact shape:\n"
        "{\n"
        '  "workflow": "book|research|single_output",\n'
        '  "workflow_reason": "...",\n'
        '  "mode": "architect|critic|clarity|coach|therapist|cold_critic|analyst",\n'
        '  "audience": "...",\n'
        '  "constraints": "...",\n'
        '  "output_format": "...",\n'
        '  "rationale": {\n'
        '    "mode": "...",\n'
        '    "audience": "...",\n'
        '    "constraints": "...",\n'
        '    "output_format": "..."\n'
        "  }\n"
        "}"
    )


async def suggest_setup(
    client: OpenRouterClient,
    model: str | None,
    objective: str,
    answers: list[GuideAnswer] | None = None,
) -> SetupSuggestion:
    """Run the Smart Setup LLM call. Defensive on missing/invalid fields."""
    prompt = build_setup_prompt(objective, answers)

    try:
        result, _usage = await client.generate_json(
            prompt=prompt,
            system=SETUP_SUGGESTER_SYSTEM,
            temperature=0.3,
            max_tokens=640,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Setup suggestion LLM call failed: {e}")
        return SetupSuggestion(
            mode="architect",
            audience="General",
            constraints="",
            output_format="",
            rationale=SetupRationale(),
        )

    raw_mode = result.get("mode", "architect")
    mode: ModeType = raw_mode if raw_mode in _VALID_MODES else "architect"
    if raw_mode not in _VALID_MODES:
        logger.warning(f"Setup suggestion returned invalid mode {raw_mode!r}, falling back to architect")

    rationale_raw = result.get("rationale") or {}
    if not isinstance(rationale_raw, dict):
        rationale_raw = {}

    return SetupSuggestion(
        mode=mode,
        audience=result.get("audience") or "General",
        constraints=result.get("constraints") or "",
        output_format=result.get("output_format") or "",
        rationale=SetupRationale(
            mode=rationale_raw.get("mode") or "",
            audience=rationale_raw.get("audience") or "",
            constraints=rationale_raw.get("constraints") or "",
            output_format=rationale_raw.get("output_format") or "",
        ),
        workflow=result.get("workflow") if result.get("workflow") in _VALID_WORKFLOWS else "single_output",
        workflow_reason=str(result.get("workflow_reason") or ""),
    )


# ---------------------------------------------------------------------------
# "Guide me" — PM-09's second way in
# ---------------------------------------------------------------------------

GUIDE_QUESTIONS_SYSTEM = (
    "You are the intake layer of PromptMaster. A user has said what they want "
    "to do or figure out, but not enough to set the work up well. Ask the few "
    "questions whose answers would most change how the work is set up: who it "
    "is for, what a good result looks like, what must be included or avoided, "
    "how long or deep it should be, and whether it is one piece of writing, a "
    "long document, or an investigation. Never ask something the objective "
    "already answers. Ask 3 to 5 questions, each short and plain, each with a "
    "one-line reason and up to four short example answers the user can click. "
    "Return JSON only."
)


def build_guide_questions_prompt(objective: str) -> str:
    return (
        f"Objective: {objective}\n\n"
        "Return JSON in this exact shape:\n"
        "{\n"
        '  "questions": [\n'
        '    {"id": "q1", "question": "...", "why": "...", "options": ["...", "..."]}\n'
        "  ]\n"
        "}"
    )


_FALLBACK_QUESTIONS = [
    GuideQuestion(id="q1", question="Who is this for?", why="Audience decides tone and depth.",
                  options=["Just me", "My team", "Executives", "The public"]),
    GuideQuestion(id="q2", question="What would a great result look like?",
                  why="It sets the bar the work is judged against."),
    GuideQuestion(id="q3", question="Is this one piece, a long document, or a question to investigate?",
                  why="It decides the workflow.",
                  options=["One piece", "A long document", "A question to investigate"]),
]


async def suggest_guide_questions(
    client: OpenRouterClient,
    model: str | None,
    objective: str,
) -> list[GuideQuestion]:
    """3-5 questions for the 'Guide me' path. Falls back to a generic three."""
    try:
        result, _usage = await client.generate_json(
            prompt=build_guide_questions_prompt(objective),
            system=GUIDE_QUESTIONS_SYSTEM,
            temperature=0.4,
            max_tokens=700,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Guide questions LLM call failed: {e}")
        return list(_FALLBACK_QUESTIONS)

    questions: list[GuideQuestion] = []
    for index, raw in enumerate(result.get("questions") or []):
        if not isinstance(raw, dict) or not str(raw.get("question") or "").strip():
            continue
        options = [str(o).strip() for o in (raw.get("options") or []) if str(o).strip()][:4]
        questions.append(GuideQuestion(
            id=str(raw.get("id") or f"q{index + 1}"),
            question=str(raw["question"]).strip(),
            why=str(raw.get("why") or "").strip(),
            options=options,
        ))
    return questions[:5] or list(_FALLBACK_QUESTIONS)


# ---------------------------------------------------------------------------
# "Guide me", one question at a time
# ---------------------------------------------------------------------------
#
# The batch above asks three to five questions written before any of them is
# answered, so the third cannot depend on the first. The client's 1 Oct
# feedback, item 9: "optionally ask one question at a time and branch based
# on previous answers; let the user stop questioning whenever PromptMaster has
# enough context". This asks for the single next question given what has been
# answered, and may answer that it has enough.

MAX_GUIDE_QUESTIONS = 6

GUIDE_NEXT_SYSTEM = (
    "You are the intake layer of PromptMaster. A user has said what they want "
    "to do or figure out and has answered some questions about it. Decide "
    "whether ONE more question is worth asking, and if so, ask it.\n\n"
    "Ask only a question whose answer would change how the work is set up — "
    "who it is for, what a good result looks like, what data or evidence "
    "exists, what must be included or avoided, how deep it should go, whether "
    "it is one piece, a long document or an investigation. Let the answers so "
    "far decide what to ask next: follow up on what they opened, and never ask "
    "what the objective or an earlier answer already settles.\n\n"
    "If you already know enough to set the work up well, say so instead of "
    "asking: enough is a good answer, and three questions is often enough.\n\n"
    "A question is short and plain, with a one-line reason and up to four "
    "short example answers the user can click. Set \"multi\" to true when "
    "several of the options could apply at once (kinds of data available, "
    "things to include), and false when they exclude one another (one "
    "audience, one length). Return JSON only."
)


def build_guide_next_prompt(objective: str, answered: list[dict[str, str]]) -> str:
    so_far = "\n".join(
        f"- Q: {a.get('question', '').strip()}\n  A: {a.get('answer', '').strip() or '(skipped)'}" for a in answered
    ) or "(nothing asked yet)"
    return (
        f"Objective: {objective}\n\n"
        f"ASKED AND ANSWERED SO FAR:\n{so_far}\n\n"
        "Return JSON in exactly one of these shapes:\n"
        '{"enough": true, "reason": "one line: what you now know"}\n'
        '{"enough": false, "question": {"question": "...", "why": "...", "options": ["...", "..."], "multi": false}}'
    )


def parse_guide_next(result: object, asked: int) -> tuple[bool, GuideQuestion | None, str]:
    """(enough, question, reason). Anything unusable is "enough": a broken
    question must not trap the user in the intake."""
    if not isinstance(result, dict):
        return True, None, ""
    raw = result.get("question")
    if result.get("enough") or not isinstance(raw, dict) or not str(raw.get("question") or "").strip():
        return True, None, str(result.get("reason") or "").strip()
    options = [str(o).strip() for o in (raw.get("options") or []) if str(o).strip()][:4]
    return False, GuideQuestion(
        id=f"q{asked + 1}",
        question=str(raw["question"]).strip(),
        why=str(raw.get("why") or "").strip(),
        options=options,
        # Several answers only make sense when there are options to pick among.
        multi=bool(raw.get("multi")) and len(options) > 1,
    ), ""


async def suggest_next_guide_question(
    client: OpenRouterClient,
    model: str | None,
    objective: str,
    answered: list[dict[str, str]],
) -> tuple[bool, GuideQuestion | None, str]:
    """The next question, or that there is enough. One small call.

    Stops by itself at MAX_GUIDE_QUESTIONS without a call. If the call fails,
    the generic questions are asked in turn so the path still works.
    """
    if len(answered) >= MAX_GUIDE_QUESTIONS:
        return True, None, "That is enough to set this up."
    try:
        result, _usage = await client.generate_json(
            prompt=build_guide_next_prompt(objective, answered),
            system=GUIDE_NEXT_SYSTEM,
            temperature=0.3,
            max_tokens=400,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Guide next-question LLM call failed: {e}")
        asked = {a.get("question", "").strip() for a in answered}
        remaining = [q for q in _FALLBACK_QUESTIONS if q.question not in asked]
        if not remaining:
            return True, None, ""
        return False, remaining[0].model_copy(update={"id": f"q{len(answered) + 1}"}), ""
    return parse_guide_next(result, len(answered))
