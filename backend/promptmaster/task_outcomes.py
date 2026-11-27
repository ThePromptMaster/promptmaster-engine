"""Why a task the work moved past was closed (L-315, 27 Nov).

Sean, payroll cutover: once South's completion report was in, the final pack
said North N8 was the only run left, while the task list still told the next
operator to run South on the old system. He asked that a completion report
close its run, a replaced file retire its tasks, and that the app "show which
report retired it".

Whether a task is retired is decided in the browser, in code: it was a sentence
of its deliverable, and the deliverable's newer version no longer says it. This
call only labels why, for each task already being retired:

- done: a fact reports the action happened ("South S4 ran successfully on the
  new system at 3:10 p.m. (OPS-02)"), quoted from that fact;
- replaced: a fact or the current text gives a different instruction in its
  place, quoted;
- reworded: the current text still asks for the same action in other words,
  quoted from the current text, so the task carries on under its new words;
- gone: none of these can be shown.

A quote is kept only when it is found, word for word, in the fact or text it is
said to come from. Any failure labels nothing, and every task is "no longer in
the work". A check, so it never searches the web.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient

#: Reading a few task lines against the facts does not need the default model.
TASK_OUTCOMES_MODEL = "anthropic/claude-sonnet-5.5"

MAX_TASKS = 24
MAX_FACTS = 120

TASK_OUTCOMES_INSTRUCTION = (
    "A project keeps a list of real-world actions people still have to carry out. Each TASK below was "
    "taken word for word from an earlier version of a document, and the current version of that document "
    "no longer says it. For each task, say why, using only the FACTS and the CURRENT TEXT given.\n\n"
    "- done: a fact reports that this very action has already been carried out (it ran, it was paid, it "
    "was sent, it arrived). Quote the words of that fact that report it.\n"
    "- replaced: a fact or the current text gives a different instruction for the same thing (another "
    "file, another system, another person, another date), so this one no longer applies. Quote those words.\n"
    "- reworded: the current text still asks for the same action, in other words, and nothing about who, "
    "what or which version changed. Copy that sentence of the current text exactly into \"now\".\n"
    "- gone: none of these can be shown from what is given.\n\n"
    "Copy every quote exactly from the fact or the current text, 8 to 300 characters. Never write a quote of "
    "your own. If you are unsure, say gone.\n\n"
    "Return JSON only: {\"outcomes\": [{\"id\": \"...\", \"outcome\": \"done|replaced|reworded|gone\", "
    "\"quote\": \"...\", \"now\": \"...\"}]}."
)


class TaskLine(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    text: str = Field(..., min_length=1, max_length=600)
    #: The stage the task came from, as the page names it.
    stage: str = Field(default="", max_length=300)
    #: That stage's current text, clipped: where a reworded task is found.
    current: str = Field(default="", max_length=30_000)


class FactLine(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    text: str = Field(..., min_length=1, max_length=2_500)


class TaskOutcomesRequest(BaseModel):
    objective: str = Field(default="", max_length=4_000)
    tasks: list[TaskLine] = Field(default_factory=list, max_length=MAX_TASKS)
    facts: list[FactLine] = Field(default_factory=list, max_length=MAX_FACTS)
    model: str = Field(default="", max_length=200)


class TaskOutcome(BaseModel):
    id: str
    outcome: Literal["done", "replaced", "reworded", "gone"]
    quote: str = ""
    #: For "reworded": the current text's sentence that carries the task on.
    now: str = ""


class TaskOutcomesResponse(BaseModel):
    outcomes: list[TaskOutcome] = Field(default_factory=list)


def build_task_outcomes_prompt(req: TaskOutcomesRequest) -> tuple[str, str]:
    tasks = "\n\n".join(
        f"[{t.id}] from {t.stage or 'a stage'}\nTASK: {' '.join(t.text.split())}\n"
        f"CURRENT TEXT OF THAT DOCUMENT:\n{t.current.strip() or '(not given)'}"
        for t in req.tasks
    )
    facts = "\n".join(f"[{f.id}] {' '.join(f.text.split())}" for f in req.facts) or "(none)"
    user = f"OBJECTIVE: {req.objective}\n\nFACTS:\n{facts}\n\nTASKS:\n{tasks}"
    return TASK_OUTCOMES_INSTRUCTION, user


def _clean(value: object) -> str:
    return " ".join(str(value or "").split()).strip('"“”')[:300]


def parse_task_outcomes(result: object, req: TaskOutcomesRequest) -> TaskOutcomesResponse:
    """A label is kept only with words found where it says they are; anything else is "gone"."""
    if not isinstance(result, dict):
        return TaskOutcomesResponse()
    tasks = {t.id: t for t in req.tasks}
    facts = [f.text for f in req.facts]
    out: list[TaskOutcome] = []
    seen: set[str] = set()
    for raw in result.get("outcomes") or []:
        if not isinstance(raw, dict):
            continue
        tid = str(raw.get("id") or "").strip().strip("[]")
        task = tasks.get(tid)
        if not task or tid in seen:
            continue
        seen.add(tid)
        outcome = str(raw.get("outcome") or "").strip().lower()
        quote = _clean(raw.get("quote"))
        now = _clean(raw.get("now"))
        if outcome == "done" and quote and _found(quote, *facts):
            out.append(TaskOutcome(id=tid, outcome="done", quote=quote))
        elif outcome == "replaced" and quote and _found(quote, *facts, task.current):
            out.append(TaskOutcome(id=tid, outcome="replaced", quote=quote))
        elif outcome == "reworded" and now and task.current and _found(now, task.current):
            out.append(TaskOutcome(id=tid, outcome="reworded", now=now))
        else:
            out.append(TaskOutcome(id=tid, outcome="gone"))
    return TaskOutcomesResponse(outcomes=out)


async def task_outcomes(client: OpenRouterClient, req: TaskOutcomesRequest) -> TaskOutcomesResponse:
    if not req.tasks:
        return TaskOutcomesResponse()
    system, user = build_task_outcomes_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_400, model=TASK_OUTCOMES_MODEL)
    return parse_task_outcomes(result, req)
