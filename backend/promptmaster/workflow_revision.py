"""A targeted change to a designed workflow (Sean, 6 Oct, email 11: "I have to
replace the workflow prompt and regenerate the whole proposal to change
individual stages. That can rewrite instructions I wanted to keep … Users
should also be able to request a targeted change conversationally, such as
'add a verification stage,' without regenerating unrelated stages … If a
requested behavior, such as repeating a research cycle, is unsupported, the
system should say so.").

The model returns operations, never a new workflow. They are applied here, in
code, so a stage the request did not name is the same object afterwards — not
a regenerated one that reads similarly. What PromptMaster's engine cannot do
is returned as `unsupported`, with why, rather than approximated silently.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .workflow_designer import KINDS, MAX_STAGES, MIN_STAGES, DesignedStage, DesignedWorkflow, Execution, _clip, fix_loops, parse_execution

#: What the engine can and cannot walk, told to the model so it can say which.
CAPABILITIES = (
    "WHAT A PROMPTMASTER WORKFLOW CAN BE:\n"
    f"- {MIN_STAGES} to {MAX_STAGES} stages in one order; each stage is one kind: "
    + "; ".join(f'"{k}" ({v})' for k, v in KINDS.items())
    + ".\n"
    "- Each stage has: label, purpose, instruction, required, an approval (the user's sign-off; "
    "\"routine\" if it only certifies something checkable against the material, otherwise "
    "\"decision\"), and a separate reserved decision for new commitments.\n"
    "- A check stage comes after the work it checks; the first and last stages are not checks.\n"
    "- Ongoing work: ONE stage just before the last may close a round and loop back to one earlier "
    "stage (loop_back_to); a new round is started by the user, or by Go when it runs Autonomous with "
    "routine decisions handled.\n"
    "- The workflow says whether it is finite or ongoing, its success criterion and its stop conditions.\n"
    "WHAT IT CANNOT DO (say so in \"unsupported\"): branches that run in parallel; routing that skips "
    "or chooses stages by a condition; more than one loop, or a loop that repeats only part of a round "
    "on its own; running on a schedule or a timer; sending email or acting outside the project; more "
    f"than {MAX_STAGES} stages."
)

_INSTRUCTION = (
    "You change a workflow the user is designing, exactly as they ask and no more. Return "
    "OPERATIONS, not a new workflow. Touch only the stages the request is about; a stage the "
    "request does not name is left out of your answer entirely. If part of the request is "
    "something the workflow cannot do, put it in \"unsupported\" with the reason, and do the "
    "nearest thing it can only if the request allows it — saying so in \"note\".\n\n" + CAPABILITIES
)

EDITABLE = ("label", "short_label", "kind", "purpose", "instruction", "required", "approval", "approval_kind", "decision", "loop_back_to")


class Unsupported(BaseModel):
    request: str = Field(max_length=300)
    reason: str = Field(max_length=400)


class RevisedWorkflow(BaseModel):
    workflow: DesignedWorkflow
    #: What was done, one line each ("Added 'Verification' after 'Analysis'").
    changes: list[str] = Field(default_factory=list)
    unsupported: list[Unsupported] = Field(default_factory=list)
    note: str = Field(default="", max_length=600)


def build_revision_prompt(design: DesignedWorkflow, request: str) -> tuple[str, str]:
    lines = []
    for i, s in enumerate(design.stages):
        lines.append(
            f"{i + 1}. {s.label} [{s.kind}]{' (optional)' if not s.required else ''}"
            + (f" — loops back to {s.loop_back_to}" if s.loop_back_to else "")
            + f"\n   purpose: {s.purpose}\n   instruction: {s.instruction[:600]}"
            + (f"\n   approval ({s.approval_kind}): {s.approval}" if s.approval else "")
            + (f"\n   decision: {s.decision}" if s.decision else "")
        )
    ex = design.execution
    user = (
        f"THE WORKFLOW: {design.name}\n"
        f"EXECUTION: {ex.kind}; success: {ex.success_criterion or '(not set)'}; stop when: {'; '.join(ex.stop_conditions) or '(not set)'}\n"
        "STAGES:\n" + "\n".join(lines) + "\n\n"
        f"THE USER ASKS: {request.strip()}\n\n"
        "Return JSON only:\n"
        '{"operations": [\n'
        '  {"op": "add_stage", "after": 3, "stage": {"label": "...", "short_label": "...", "kind": "write|list|check", '
        '"purpose": "...", "instruction": "...", "required": true, "approval": "", "approval_kind": "decision", "decision": ""}},\n'
        '  {"op": "edit_stage", "stage": 2, "fields": {"instruction": "..."}},\n'
        '  {"op": "remove_stage", "stage": 4},\n'
        '  {"op": "move_stage", "stage": 4, "to": 2},\n'
        '  {"op": "set_execution", "execution": {"kind": "ongoing", "success_criterion": "...", "stop_conditions": ["..."]}}\n'
        '], "unsupported": [{"request": "...", "reason": "..."}], "note": ""}\n'
        'Stage numbers are as listed above (1-based); "after": 0 adds at the start. Only these ops.'
    )
    return _INSTRUCTION, user


def _stage_from(raw: dict) -> DesignedStage | None:
    label = _clip(raw.get("label"), 60)
    kind = str(raw.get("kind") or "").strip().lower()
    if not label or kind not in KINDS:
        return None
    return DesignedStage(
        label=label,
        short_label=_clip(raw.get("short_label"), 24) or label[:24],
        kind=kind,
        purpose=_clip(raw.get("purpose"), 2_000),
        instruction=str(raw.get("instruction") or "").strip()[:20_000] or f"Produce the {label.lower()}.",
        required=raw.get("required") is not False,
        approval=_clip(raw.get("approval"), 120),
        approval_kind="routine" if str(raw.get("approval_kind") or "").strip().lower() == "routine" else "decision",
        decision=_clip(raw.get("decision"), 120),
        loop_back_to=_clip(raw.get("loop_back_to"), 60),
    )


def apply_operations(design: DesignedWorkflow, result: object) -> RevisedWorkflow:
    """Apply the operations in order, by stage identity, not by position after
    an earlier op shifted them. An operation that names no stage, or would
    leave the workflow unwalkable, is skipped and said."""
    if not isinstance(result, dict):
        raise ValueError("The change came back in a form that could not be read.")
    # Work on copies; keep the originals' identity by index into the original list.
    stages = [s.model_copy() for s in design.stages]
    originals = list(stages)  # the objects ops refer to by their listed number
    execution = design.execution.model_copy()
    changes: list[str] = []
    skipped: list[Unsupported] = []

    def by_number(n: object) -> DesignedStage | None:
        try:
            i = int(n) - 1  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        return originals[i] if 0 <= i < len(originals) and originals[i] in stages else None

    for op in (result.get("operations") or [])[:12]:
        if not isinstance(op, dict):
            continue
        kind = op.get("op")
        if kind == "add_stage" and isinstance(op.get("stage"), dict):
            new = _stage_from(op["stage"])
            if not new:
                continue
            if len(stages) >= MAX_STAGES:
                skipped.append(Unsupported(request=f"Add {new.label}", reason=f"A workflow has at most {MAX_STAGES} stages."))
                continue
            after = op.get("after")
            anchor = by_number(after) if after not in (0, "0", None) else None
            pos = stages.index(anchor) + 1 if anchor else (0 if after in (0, "0") else len(stages) - 1)
            stages.insert(pos, new)
            changes.append(f"Added “{new.label}”" + (f" after “{anchor.label}”" if anchor else ""))
        elif kind == "edit_stage":
            target = by_number(op.get("stage"))
            fields = op.get("fields") if isinstance(op.get("fields"), dict) else {}
            if not target or not fields:
                continue
            patch: dict = {}
            for key, value in fields.items():
                if key not in EDITABLE:
                    continue
                if key == "kind":
                    if str(value) in KINDS:
                        patch["kind"] = str(value)
                elif key == "required":
                    patch["required"] = value is not False
                elif key == "approval_kind":
                    patch["approval_kind"] = "routine" if str(value).lower() == "routine" else "decision"
                elif key == "instruction":
                    patch["instruction"] = str(value or "").strip()[:20_000]
                else:
                    limit = {"label": 60, "short_label": 24, "purpose": 2_000, "approval": 120, "decision": 120, "loop_back_to": 60}[key]
                    patch[key] = _clip(value, limit)
            if not patch:
                continue
            i = stages.index(target)
            stages[i] = target.model_copy(update=patch)
            originals[originals.index(target)] = stages[i]
            changes.append(f"Changed “{target.label}”: {', '.join(sorted(patch))}")
        elif kind == "remove_stage":
            target = by_number(op.get("stage"))
            if not target:
                continue
            if len(stages) <= MIN_STAGES:
                skipped.append(Unsupported(request=f"Remove {target.label}", reason=f"A workflow needs at least {MIN_STAGES} stages."))
                continue
            stages.remove(target)
            changes.append(f"Removed “{target.label}”")
        elif kind == "move_stage":
            target = by_number(op.get("stage"))
            try:
                to = int(op.get("to")) - 1
            except (TypeError, ValueError):
                continue
            if not target or not (0 <= to < len(stages)):
                continue
            stages.remove(target)
            stages.insert(to, target)
            changes.append(f"Moved “{target.label}” to position {to + 1}")
        elif kind == "set_execution" and isinstance(op.get("execution"), dict):
            execution = parse_execution(op["execution"])
            changes.append(f"Execution set to {execution.kind}")

    # The ends stay walkable: no check stage first or last; first and last required.
    if stages and (stages[0].kind == "check" or stages[-1].kind == "check"):
        raise ValueError("That change would put a check stage first or last; a check comes after the work it checks.")
    if len(stages) < MIN_STAGES:
        raise ValueError(f"A workflow needs at least {MIN_STAGES} stages.")
    stages[0] = stages[0] if stages[0].required else stages[0].model_copy(update={"required": True})
    stages[-1] = stages[-1] if stages[-1].required else stages[-1].model_copy(update={"required": True})
    before_loops = [s.loop_back_to for s in stages]
    stages = fix_loops(stages, execution)
    if any(b and not s.loop_back_to for b, s in zip(before_loops, stages)):
        skipped.append(Unsupported(request="A repeating round", reason="Only one stage, just before the last, may loop back to an earlier stage, and only in an ongoing workflow."))

    unsupported = [
        Unsupported(request=_clip(u.get("request"), 300), reason=_clip(u.get("reason"), 400))
        for u in (result.get("unsupported") or []) if isinstance(u, dict) and _clip(u.get("request"), 300)
    ] + skipped
    return RevisedWorkflow(
        workflow=design.model_copy(update={"stages": stages, "execution": execution}),
        changes=changes,
        unsupported=unsupported[:8],
        note=_clip(result.get("note"), 600),
    )


async def revise_workflow(client: OpenRouterClient, model: str | None, design: DesignedWorkflow, request: str) -> RevisedWorkflow:
    system, user = build_revision_prompt(design, request)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0.2, max_tokens=3_000, model=model)
    return apply_operations(design, result)
