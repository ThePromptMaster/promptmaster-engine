"""Which of the things waiting on the user would one answer settle? (12 Nov)

A client: "figures out the fewest questions it needs to ask me to unlock the
most work. If one answer clears three blockers, Go should ask once, apply the
answer everywhere it matters, and keep going."

The list of what waits on the user is made in code, from the project's own
records (`lib/agent/user-queue.ts`). This call only says which of its items are
the same question in different words, or are decided by one and the same
answer, and words that question once. Every group is checked in code: its ids
must be ones that were sent, an item belongs to one group at most, and a group
of one is no group. What an answer then closes is decided separately, by the
user's own words (`settled_items.py`); a wrong grouping here costs a merged
question that reads oddly, never a finding closed by mistake.

One small model call. Any failure groups nothing: the items are asked one by
one, in the order code ranked them.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .schemas import PMInput

GROUPS_MODEL = "anthropic/claude-sonnet-5.5"

MAX_ITEMS = 8
MAX_CHOICES = 4

GROUPS_INSTRUCTION = (
    "A project has several things waiting on its user: findings a review left open, and questions set "
    "aside earlier. Some of them would be settled by one and the same answer from the user: they ask the "
    "same thing in different words, or a single decision or fact decides them all. Find those, so the "
    "user is asked once.\n\n"
    "Group ONLY items that one answer really settles together. Two items about the same subject that need "
    "different answers are not a group. When in doubt, leave an item out: it is then asked on its own.\n\n"
    "For each group give:\n"
    "- ids: the ids of its items, two or more\n"
    "- question: the one question to ask, in the user's terms, in at most two sentences. Say what is at "
    "stake, not which document raised it. Do not answer it and do not recommend an answer\n"
    "- choices: two to four short answers the user might give, in their voice, when the question has "
    "natural ones; otherwise an empty list\n\n"
    "Return JSON only: {\"groups\": [{\"ids\": [\"...\"], \"question\": \"...\", \"choices\": [\"...\"]}]}. "
    "Return an empty list when nothing belongs together."
)


class WaitingItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=200)
    stage: str = Field(default="", max_length=300)
    #: What is asked, as the project words it, with the note on it when there is one.
    text: str = Field(..., min_length=1, max_length=2_500)


class GroupQuestionsRequest(BaseModel):
    inputs: PMInput
    items: list[WaitingItem] = Field(default_factory=list, max_length=MAX_ITEMS)
    model: str = Field(default="", max_length=200)


class QuestionGroup(BaseModel):
    ids: list[str]
    question: str
    choices: list[str] = Field(default_factory=list)


class GroupQuestionsResponse(BaseModel):
    groups: list[QuestionGroup] = Field(default_factory=list)


def build_groups_prompt(req: GroupQuestionsRequest) -> tuple[str, str]:
    rows = "\n".join(f"[{i.id}] {i.stage or 'A stage'}: {' '.join(i.text.split())}" for i in req.items)
    user = f"OBJECTIVE: {req.inputs.objective}\n\nWAITING ON THE USER:\n{rows}"
    return GROUPS_INSTRUCTION, user


def parse_groups(result: object, req: GroupQuestionsRequest) -> GroupQuestionsResponse:
    """A group stays only with two or more ids that were sent, none already in another group."""
    if not isinstance(result, dict):
        return GroupQuestionsResponse()
    sent = {i.id for i in req.items}
    used: set[str] = set()
    out: list[QuestionGroup] = []
    for raw in result.get("groups") or []:
        if not isinstance(raw, dict):
            continue
        ids: list[str] = []
        for value in raw.get("ids") or []:
            fid = str(value).strip().strip("[]")
            if fid in sent and fid not in used and fid not in ids:
                ids.append(fid)
        question = " ".join(str(raw.get("question") or "").split())[:400]
        if len(ids) < 2 or not question:
            continue
        choices: list[str] = []
        for value in raw.get("choices") or []:
            choice = " ".join(str(value).split()).strip("\"“”")[:160]
            if choice and choice.lower() not in {c.lower() for c in choices}:
                choices.append(choice)
        used.update(ids)
        out.append(QuestionGroup(ids=ids, question=question, choices=choices[:MAX_CHOICES] if len(choices) >= 2 else []))
    return GroupQuestionsResponse(groups=out)


async def group_questions(client: OpenRouterClient, req: GroupQuestionsRequest) -> GroupQuestionsResponse:
    if len(req.items) < 2:
        return GroupQuestionsResponse()
    system, user = build_groups_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=700, model=GROUPS_MODEL)
    return parse_groups(result, req)
