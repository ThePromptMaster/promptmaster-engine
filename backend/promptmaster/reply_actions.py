"""A side-chat answer, compressed into a few things the user can do about it.

The side chat used to turn every bullet of a reply into its own Apply button:
a good explanation of why eleven works were unverified became "Apply all 14
recommended fixes" (the client's 1 Oct feedback, items 13 and 34: "Conversation
can be rich. Actions should be compressed into a small number of clear,
meaningful buttons"). The splitting was a Markdown list parser, so it could
not tell a point from an action.

This asks for the actions directly: at most four, each one a change the user
would recognise as a single decision. On a table stage an action is a set of
row changes rather than a prose rewrite (item 15). Nothing here changes the
project: the client shows the buttons, previews what one would do, and writes
only on the user's click.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import PMInput

MAX_ACTIONS = 4
MAX_ROWS_PER_ACTION = 30


class TableField(BaseModel):
    key: str
    label: str = ""


class TableStatus(BaseModel):
    value: str
    label: str = ""
    requires_reason: bool = False


class ActionTable(BaseModel):
    """The stage's table as the model may change it: its columns, the statuses a
    user could choose, and the rows by id."""
    item_label: str = "row"
    fields: list[TableField] = Field(default_factory=list, max_length=12)
    statuses: list[TableStatus] = Field(default_factory=list, max_length=12)
    rows: list[dict[str, str]] = Field(default_factory=list, max_length=60)


class RowUpdate(BaseModel):
    id: str
    status: str = ""
    reason: str = ""
    fields: dict[str, str] = Field(default_factory=dict)


class ReplyAction(BaseModel):
    label: str
    kind: Literal["revise", "row_updates", "add_rows"]
    #: `revise`: what to change about the draft, as one instruction.
    instruction: str = ""
    #: `row_updates`: changes to existing rows.
    updates: list[RowUpdate] = Field(default_factory=list)
    #: `add_rows`: new rows, by field key.
    rows: list[dict[str, str]] = Field(default_factory=list)


_REPLY_ACTIONS_INSTRUCTION = (
    "TURN AN ANSWER INTO ACTIONS. Below is a question the user asked about "
    "their work and the answer they were given. Offer the few things they "
    "could now DO about it, as buttons.\n\n"
    "Rules:\n"
    f"- At most {MAX_ACTIONS} actions; fewer is better. Zero is a fine answer "
    "when the reply only explained something and nothing needs to change.\n"
    "- One action is one decision the user would recognise, not one sentence "
    "of the answer. Group related points into a single action.\n"
    "- The label is what the button says: an imperative of at most six words "
    "(\"Mark all sources unverified\", \"Update the Mid-Market hypothesis\"). "
    "No full stops, no \"Apply\".\n"
    "- Never invent an action the answer does not support.\n"
)

_PROSE_KINDS = (
    "The work is a written draft. Every action has kind \"revise\" and an "
    "\"instruction\": one or two sentences saying exactly what to change, "
    "specific enough to carry out without the conversation.\n"
)

_TABLE_KINDS = (
    "The work is a TABLE, listed below with each row's id. Change rows, not "
    "prose:\n"
    "- kind \"row_updates\": \"updates\" is a list of {\"id\", and any of "
    "\"status\", \"reason\", \"fields\": {key: new text}}. Use only ids that "
    "are listed, only statuses that are listed, and give a \"reason\" where "
    "the status requires one. Change only what the answer supports.\n"
    "- kind \"add_rows\": \"rows\" is a list of new rows, each an object of "
    "the listed field keys.\n"
    "Do not use kind \"revise\" for a table.\n"
)

_SHAPE = (
    "Return JSON only:\n"
    '{"actions": [{"label": "...", "kind": "revise", "instruction": "..."}, '
    '{"label": "...", "kind": "row_updates", "updates": [{"id": "...", "status": "...", "reason": "...", "fields": {}}]}, '
    '{"label": "...", "kind": "add_rows", "rows": [{}]}]}'
)


def build_reply_actions_prompt(
    inputs: PMInput, stage_label: str, question: str, reply: str, table: ActionTable | None
) -> tuple[str, str]:
    """Build (system, user). Pure."""
    kinds = _TABLE_KINDS if table else _PROSE_KINDS
    system = _shared_system(inputs, [], f"{_REPLY_ACTIONS_INSTRUCTION}\n{kinds}\n{_SHAPE}")
    parts = [f"STAGE: {stage_label or '(unnamed)'}", f"OBJECTIVE: {inputs.objective or '(none)'}", ""]
    if table:
        parts.append(f"THE TABLE (one {table.item_label} per row):")
        parts.append("Columns: " + ", ".join(f"{f.key} ({f.label or f.key})" for f in table.fields))
        if table.statuses:
            parts.append(
                "Statuses: "
                + ", ".join(f"{s.value} ({s.label or s.value}{'; needs a reason' if s.requires_reason else ''})" for s in table.statuses)
            )
        for row in table.rows:
            rid = row.get("id", "")
            cells = "; ".join(f"{k}: {str(v)[:160]}" for k, v in row.items() if k != "id" and str(v).strip())
            parts.append(f"- id={rid}: {cells}")
        parts.append("")
    parts += [
        "--- THE USER ASKED ---",
        question.strip() or "(no question recorded)",
        "--- THE ANSWER THEY WERE GIVEN ---",
        reply.strip(),
        "--- END ---",
        "",
        "Offer the actions.",
    ]
    return system, "\n".join(parts)


def _clean_label(value: object) -> str:
    label = " ".join(str(value or "").split()).rstrip(".")
    return label[:60]


def parse_reply_actions(raw: object, table: ActionTable | None) -> list[ReplyAction]:
    """Keep only actions that can be carried out as stated.

    A table action that names a row which is not there, or a status the table
    does not have, is dropped row by row; an action left with nothing to do is
    dropped whole. A prose action on a table (and the reverse) is dropped: sent
    on, it would be a table rewritten as text.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("actions"), list):
        return []
    known_ids = {r.get("id") for r in (table.rows if table else [])}
    statuses = {s.value: s for s in (table.statuses if table else [])}
    field_keys = {f.key for f in (table.fields if table else [])}
    out: list[ReplyAction] = []
    for item in raw["actions"]:
        if len(out) >= MAX_ACTIONS:
            break
        if not isinstance(item, dict):
            continue
        label = _clean_label(item.get("label"))
        kind = item.get("kind")
        if not label:
            continue
        if kind == "revise" and not table:
            instruction = str(item.get("instruction") or "").strip()
            if instruction:
                out.append(ReplyAction(label=label, kind="revise", instruction=instruction[:1_500]))
        elif kind == "row_updates" and table:
            updates: list[RowUpdate] = []
            for u in (item.get("updates") or [])[:MAX_ROWS_PER_ACTION]:
                if not isinstance(u, dict) or u.get("id") not in known_ids:
                    continue
                status = str(u.get("status") or "").strip()
                reason = str(u.get("reason") or "").strip()
                if status and status not in statuses:
                    status = ""
                if status and statuses[status].requires_reason and not reason:
                    status = ""
                fields = {
                    k: str(v).strip() for k, v in (u.get("fields") or {}).items()
                    if isinstance(u.get("fields"), dict) and k in field_keys and str(v).strip()
                }
                if status or fields:
                    updates.append(RowUpdate(id=u["id"], status=status, reason=reason if status else "", fields=fields))
            if updates:
                out.append(ReplyAction(label=label, kind="row_updates", updates=updates))
        elif kind == "add_rows" and table:
            rows = []
            for r in (item.get("rows") or [])[:MAX_ROWS_PER_ACTION]:
                if not isinstance(r, dict):
                    continue
                row = {k: str(v).strip() for k, v in r.items() if k in field_keys and str(v).strip()}
                if row:
                    rows.append(row)
            if rows:
                out.append(ReplyAction(label=label, kind="add_rows", rows=rows))
    return out


async def suggest_reply_actions(
    client: OpenRouterClient, model: str | None, inputs: PMInput, stage_label: str,
    question: str, reply: str, table: ActionTable | None,
) -> list[ReplyAction]:
    system, user = build_reply_actions_prompt(inputs, stage_label, question, reply, table)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0.2, max_tokens=1_500, model=model)
    return parse_reply_actions(raw, table)
