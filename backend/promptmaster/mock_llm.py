"""Scripted stand-in for OpenRouterClient, for deterministic browser E2E runs.

Enabled by `PM_LLM_MODE=mock` (see deps.py) and never in production: `deps`
refuses to start in mock mode when `VERCEL_ENV=production`, and a test pins
that. The point is that Playwright can walk the real UI against the real
FastAPI routers and the real prompt builders, with only the network hop to
the provider replaced — so an E2E failure means the product is broken, not
that a model had a creative day.

Only `_request_with_retries` is overridden. `generate`, `generate_with_meta`
and `generate_json` run exactly as in production, including JSON cleaning and
the repair pass, which keeps this double honest about the parsing paths.

Which reply to give is decided by the system prompt, matched against the real
prompt constants imported from each module — so editing prompt wording cannot
silently desynchronise the mock.

Fault injection, for testing recovery paths (FR-16, PM-04): put a marker in
anything that reaches a prompt, e.g. the project objective or a section title.
  [[mock:402]]      -> out of credits (non-retryable)
  [[mock:429]]      -> rate limited
  [[mock:500]]      -> provider error
  [[mock:length]]   -> finish_reason "length" (truncated output)
  [[mock:slow=N]]   -> sleep N seconds before answering
  [[mock:402x1]]    -> the same, but only the first N section-writing calls
                       carrying it (402x1, 500x2, ...) fail; later ones
                       succeed — a transient failure a retry can recover
                       from. Counted markers fire only in long-form section
                       calls ("← WRITING NOW"): other stages also list the
                       outline and would otherwise use the failure up first.

In a long-form section prompt the whole outline is listed, so a marker in one
section title would otherwise fire for every section. There, markers on
outline lines count only on the line being written ("← WRITING NOW").
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from promptmaster.llm_client import OpenRouterClient, OpenRouterError

MOCK_MODEL = "mock/scripted"

_MARKER = re.compile(r"\[\[mock:([a-z0-9]+?)(?:x(\d+))?(?:=(\d+))?\]\]")
_OUTLINE_LINE = re.compile(r"^\d+\. .*$", re.M)
_WRITING_NOW = "← WRITING NOW"


def _system_and_prompt(payload: dict[str, Any]) -> tuple[str, str]:
    system, prompt = "", ""
    for message in payload.get("messages", []):
        if message.get("role") == "system":
            system = message.get("content", "")
        elif message.get("role") == "user":
            prompt = message.get("content", "")
    return system, prompt


def _scoped(text: str) -> str:
    """Drop outline lines other than the one being written, when there is one."""
    if _WRITING_NOW not in text:
        return text
    return _OUTLINE_LINE.sub(lambda m: m.group(0) if _WRITING_NOW in m.group(0) else "", text)


def _markers(text: str) -> list[tuple[str, int | None, int | None, str]]:
    """(name, times, value, the marker text itself) for each marker present."""
    return [
        (m.group(1), int(m.group(2)) if m.group(2) else None, int(m.group(3)) if m.group(3) else None, m.group(0))
        for m in _MARKER.finditer(_scoped(text))
    ]


def _objective(prompt: str) -> str:
    match = re.search(r"Objective:\s*(.+)", prompt)
    return match.group(1).strip() if match else "the stated objective"


# --- JSON replies, one per call site ---------------------------------------


def _stage_items(prompt: str) -> dict:
    """Fill the literal item example the stage prompt carries (stage._example_json)."""
    match = re.search(r'"items": \[\s*(\{.*?\}),', prompt, re.S)
    keys = ["text"]
    if match:
        try:
            keys = [k for k in json.loads(match.group(1)) if k != "id"] or ["text"]
        except json.JSONDecodeError:
            pass
    # Say whether the drafted chapters arrived, so a browser test can see that
    # the stages after drafting are reviewing the book and not a summary of it.
    read = " (read the manuscript)" if "--- BEGIN MANUSCRIPT ---" in prompt else ""
    # A status the stage says the model may set (stage._field_instructions):
    # the first row uses it with a reason, the second claims an outcome that
    # is not the model's to claim, the third says nothing — so a browser test
    # sees one row prefilled and two left for the user.
    may_set = re.search(r"only if already known: ([a-z_]+)", prompt)
    # A status the draft may propose (3 Oct): the first two rows propose one,
    # with a reason; the third says nothing, so a browser test sees two
    # proposals to confirm and one row left for the user.
    proposes = re.search(r"the status this row's text supports: ([a-z_ ]+)\)", prompt)
    options = proposes.group(1).split(" or ") if proposes else []
    items = []
    for n in range(1, 4):
        item: dict[str, str] = {"id": f"i{n}"}
        for i, key in enumerate(keys):
            if key in ("status", "reason") and options:
                if n <= 2:
                    item[key] = options[min(n - 1, len(options) - 1)] if key == "status" else f"Mock: row {n} says so."
            elif key in ("status", "reason") and may_set:
                if n == 1:
                    item[key] = may_set.group(1) if key == "status" else "Mock: the data this needs was never provided."
                elif n == 2 and key == "status":
                    item[key] = "completed"
            elif key == "status":
                item[key] = "clean"
            elif key == "severity":
                # One finding that changes the work, the rest routine (B3).
                item[key] = "major" if n == 1 else "minor"
            else:
                item[key] = f"Mock {key.replace('_', ' ')} {n}{read if i == 0 else ''}"
        items.append(item)
    return {"items": items}


_FINDINGS = re.compile(r"\[\[mock:findings=(\d+)\]\]")
_STYLE = re.compile(r"CRITIQUE INTENSITY — ([A-Z]+)\..*?COMMUNICATION TONE — ([A-Z]+)\.", re.S)


def _stage_evaluation(system: str = "", prompt: str = "") -> dict:
    """Clean by default. `[[mock:findings=N]]` in the objective gives N findings,
    Medium scores and a correction, so the after-critique actions have
    something to act on. The critique style the prompt carried is echoed back,
    so a test can see PM-21's settings reached the evaluator."""
    style = _STYLE.search(system)
    echo = f" (intensity {style.group(1).lower()}, tone {style.group(2).lower()})" if style else ""
    wanted = _FINDINGS.search(system + "\n" + prompt)
    count = int(wanted.group(1)) if wanted else 0
    if count:
        findings = [
            {"id": f"f{i}", "category": "clarity", "summary": f"Mock finding {i}: point {i} is vague.",
             "suggested_change": f"Make point {i} concrete."}
            for i in range(1, count + 1)
        ]
        return {
            "alignment": {"score": "Medium", "explanation": f"Mock: mostly on target{echo}."},
            "drift": {"score": "Low", "explanation": "Mock: no drift on any of the five axes."},
            "clarity": {"score": "Medium", "explanation": f"Mock: some points are vague{echo}."},
            "completeness": {"status": "complete", "reason": ""},
            "interpretation": {"label": "What to improve", "bullets": [f["summary"] for f in findings][:3]},
            "findings": findings,
            "further_pass": {"needed": True, "reason": "Mock: the findings are worth one more pass."},
            "recommendation": {
                "id": "r1", "title": "Mock: make the vague points concrete",
                "triggering_issue": "Mock: vague points", "expected_benefit": "Mock: clearer",
                "scope": "Mock: the whole stage", "instruction": "Make every vague point concrete.",
            },
        }
    return {
        "alignment": {"score": "High", "explanation": f"Mock: the draft does what this stage asked for{echo}."},
        "drift": {"score": "Low", "explanation": "Mock: no drift on any of the five axes."},
        "clarity": {"score": "High", "explanation": "Mock: plainly structured and easy to follow."},
        "completeness": {"status": "complete", "reason": ""},
        "interpretation": {
            "label": "Why this works",
            "bullets": ["Mock: matches the stage.", "Mock: clear structure.", "Mock: stays focused."],
        },
        "findings": [],
        "further_pass": {"needed": False, "reason": "Mock: it meets this stage's bar; another pass would only churn it."},
        "recommendation": None,
    }


def _legacy_evaluation() -> dict:
    evaluation = _stage_evaluation()
    evaluation.pop("findings")
    evaluation.pop("recommendation")
    return evaluation


def _setup(prompt: str) -> dict:
    objective = _objective(prompt).lower()
    if "book" in objective:
        workflow, reason = "book", "Mock: a book needs chapters that hold together."
    elif "research" in objective or "?" in objective:
        workflow, reason = "research", "Mock: a question to answer calls for a method."
    else:
        workflow, reason = "single_output", "Mock: one piece, done in one sitting."
    return {
        "workflow": workflow,
        "workflow_reason": reason,
        "mode": "architect",
        "audience": "General",
        "constraints": "Mock constraints for: " + _objective(prompt)[:80],
        "output_format": "Free-form prose",
        "rationale": {
            "mode": "Mock: structure suits this objective.",
            "audience": "Mock: broad readership.",
            "constraints": "Mock: keeps scope tight.",
            "output_format": "Mock: prose reads naturally.",
        },
    }


def _outline(prompt: str) -> dict:
    count_match = re.search(r"Target section count:\s*(\d+)", prompt)
    count = max(2, min(int(count_match.group(1)) if count_match else 3, 6))
    return {
        "outline": [
            {"title": f"Mock section {n}", "abstract": f"Mock abstract for section {n}."}
            for n in range(1, count + 1)
        ]
    }


def _section_record() -> dict:
    return {
        "summary": "Mock summary of the section.",
        "glossary_terms": [{"term": "Mock term", "definition": "A term defined by the mock."}],
        "decisions": ["Mock decision."],
        "todos": [],
    }


_PLAN = re.compile(r"\[\[mock:plan=([a-z_,]+)\]\]")
_ALLOWED_LINE = re.compile(r"^- ([a-z_]+): ", re.M)
_DONE_LINE = re.compile(r"^- ([a-z_]+) → ", re.M)


def _next_action(system: str, prompt: str) -> dict:
    """Go mode's planner, scripted.

    An objective carrying [[mock:plan=derive,run_computation,…]] makes the
    mock choose those moves in that order, one per call, skipping any already
    in the run's history; with no plan it takes the first allowed non-workflow
    action not yet tried. Either way it ends on declare_objective_complete, so
    a scripted run always terminates.
    """
    allowed_block = prompt.split("MOVES AVAILABLE NOW:", 1)[-1]
    allowed = _ALLOWED_LINE.findall(allowed_block)
    history_block = prompt.split("Moves made so far in this run", 1)[-1].split("MOVES AVAILABLE NOW:", 1)[0]
    done = _DONE_LINE.findall(history_block)
    plan_match = _PLAN.search(system + "\n" + prompt)
    if plan_match:
        candidates = [k for k in plan_match.group(1).split(",") if k]
        # A plan may repeat an action; count how many times each was used.
        remaining = list(done)
        choice = None
        for key in candidates:
            if key in remaining:
                remaining.remove(key)
                continue
            # A plan spans stages: a move the current stage does not offer
            # is left for the stage that does (B2b), not chosen and refused.
            if key not in allowed:
                continue
            choice = key
            break
    else:
        workflow = {"advance_stage", "mark_blocked", "request_user_decision", "declare_objective_complete", "return_to_stage"}
        choice = next((k for k in allowed if k not in done and k not in workflow), None)
    if choice is None:
        choice = "declare_objective_complete"
    params: dict = {}
    if choice == "run_computation":
        params = {"goal": "Mock: compute 2 + 2", "kind": "computation"}
        # "[[mock:row=2]]" in the objective says which row of the stage's
        # table the computation carries out.
        row = re.search(r"\[\[mock:row=(\d+)\]\]", prompt)
        if row:
            params["row"] = int(row.group(1))
    elif choice == "check_literature" and "[[mock:search]]" in system + prompt:
        # "[[mock:search]]" in the objective makes the lookup a topic search.
        params = {"query": "Mock: customer churn"}
    elif choice == "request_user_decision":
        # "[[mock:control=listed]]" names the first button the page really
        # has; "[[mock:control=invented]]" names one it does not — so a browser
        # test can see the first pointed to and the second dropped.
        listed = re.search(r'^- "([^"]+)" — ', prompt, re.M)
        if "[[mock:control=invented]]" in prompt:
            params = {"control": "Generate the outline/results artifact"}
        elif "[[mock:control=listed]]" in prompt and listed:
            params = {"control": listed.group(1)}
    elif choice == "return_to_stage":
        # Planned only ("[[mock:plan=…,return_to_stage]]"): back to the first stage listed under GO BACK TO.
        target = re.search(r"GO BACK TO \([^)]*\): ([a-z_]+) \(", prompt)
        params = {
            "stage_id": target.group(1) if target else "experiment",
            "reason": "Mock: the analysis cannot decide H2 without a fourth run.",
            "work": "Mock: run 4 — the same computation at twice the amplitude.",
        }
    elif choice == "mark_blocked":
        params = {"reason": "Mock: missing data", "block_kind": "data_missing"}
    elif choice == "propose_skip":
        params = {"reason": "Mock: the internal data should be looked at before any outside reading."}
    elif choice == "revise_stage":
        # "[[mock:conflicting-revise]]" in the objective makes the revision one
        # the conflict check objects to, so a browser test can see Go ask.
        clash = " [[mock:conflict]]" if "[[mock:conflicting-revise]]" in system + prompt else ""
        params = {"instruction": f"Mock: tighten the argument{clash}"}
    return {
        "action_key": choice,
        "params": params,
        "rationale": f"Mock: {choice} is the next scripted move.",
        "expected_outcome": f"Mock: the result of {choice}.",
        "needs_user_decision": choice == "request_user_decision",
        "decision_question": (
            "Mock: which way should this go?"
            # The client's 3 Oct example: a button named in the words, not in params.
            + (" Press Generate Outline to start." if "[[mock:control=invented]]" in prompt else "")
            # 4 Oct production: Go asks for an approval by quoting the requirement.
            + (
                " If yes, use “I agree this says what is not yet known, and that this work addresses it”."
                if "[[mock:ask=lit-gap]]" in system + prompt
                else ""
            )
        ) if choice == "request_user_decision" else None,
        "objective_complete": choice == "declare_objective_complete",
    }


def _json_reply(system: str, prompt: str) -> dict:
    # Imported here, not at module top, to avoid import cycles with modules that
    # import the client.
    from promptmaster import agent, audit_findings, continuity, evaluator, guidance, long_form, setup_suggester
    from promptmaster.stage import _LIST_INSTRUCTION
    from promptmaster.stage_evaluation import _STAGE_EVAL_INSTRUCTION

    from promptmaster import conflicts

    if system.startswith("You help someone work out a project before PromptMaster creates it"):
        # The brief takes the user's first message as the objective and every
        # sentence with a figure as evidence — plus one figure the user never
        # gave, which must be dropped. Ready from the second user turn.
        convo = prompt.split("THE CONVERSATION SO FAR:", 1)[-1].split("THE DRAFT BRIEF", 1)[0]
        users = [ln[len("USER: "):] for ln in convo.splitlines() if ln.startswith("USER: ")]
        said = " ".join(users)
        sentences = [s.strip().rstrip(".") for s in re.split(r"(?<=[.;])\s+", said) if s.strip()]
        evidence = [s for s in sentences if re.search(r"\d", s) or "must" in s.lower()]
        return {
            "reply": "Mock: who is this for?" if len(users) < 2 else "Mock: I have enough to set this up.",
            "brief": {"objective": users[0][:200] if users else "", "audience": "Mock board" if len(users) > 1 else "",
                      "requirements": [s for s in evidence if "must" in s.lower()],
                      "evidence": [s for s in evidence if "must" not in s.lower()] + ["Revenue grew 999% last year"],
                      "deliverables": ["Mock memo"], "stages": ["Brief", "Options", "Recommendation"], "approvals": ["I approve the recommendation"]},
            "ready": len(users) >= 2,
        }
    if "You change a workflow the user is designing" in system:
        # Adds "Verification" after stage 3; a request to repeat only part of a
        # round comes back as unsupported.
        asked = prompt.split("THE USER ASKS:", 1)[-1].lower()
        ops = []
        if "verif" in asked:
            ops.append({"op": "add_stage", "after": 3, "stage": {
                "label": "Verification", "short_label": "Verify", "kind": "check", "purpose": "Mock: check the analysis.",
                "instruction": "Mock: list each claim of the analysis and whether it holds.", "required": True, "approval": ""}})
        unsupported = [{"request": "Repeat only the analysis automatically", "reason": "Mock: a loop repeats a whole round."}] if "only the analysis" in asked else []
        return {"operations": ops, "unsupported": unsupported, "note": ""}
    if "You design workflows for PromptMaster" in system and "[[mock:ongoing]]" in prompt:
        # An investigation that goes on until a supported result: a round closes
        # on "Next round", which loops back to "Investigate".
        return {
            "name": "Open research", "description": "Mock: an investigation that continues until a result.",
            "deliverable": "research log", "inquiry": True,
            "execution": {"kind": "ongoing", "success_criterion": "A supported result, or a concrete blocker",
                          "stop_conditions": ["a concrete blocker", "exhausted branches"]},
            "stages": [
                {"label": "Objective", "short_label": "Objective", "kind": "write", "purpose": "Mock.", "instruction": "Mock: state it.", "required": True, "approval": ""},
                {"label": "Investigate", "short_label": "Investigate", "kind": "write", "purpose": "Mock.", "instruction": "Mock: investigate.", "required": True, "approval": ""},
                {"label": "Analysis", "short_label": "Analysis", "kind": "write", "purpose": "Mock.", "instruction": "Mock: analyse.", "required": True, "approval": ""},
                {"label": "Next round", "short_label": "Next round", "kind": "write", "purpose": "Mock.", "instruction": "Mock: what next.", "required": True, "approval": "", "loop_back_to": "Investigate"},
                {"label": "Research log", "short_label": "Log", "kind": "write", "purpose": "Mock.", "instruction": "Mock: the log.", "required": True, "approval": ""},
            ],
        }
    if "You design workflows for PromptMaster" in system:
        # A scripted magazine-feature workflow: write, list, write, check, write.
        return {
            "name": "Magazine feature", "description": "Mock: a feature from pitch to final copy.",
            "deliverable": "article", "inquiry": False,
            "stages": [
                {"label": "Pitch and angle", "short_label": "Pitch", "kind": "write", "purpose": "Mock: say what the piece argues.",
                 "instruction": "Mock: state the angle in two sentences.", "required": True, "approval": "I approve this angle"},
                {"label": "Sources to interview", "short_label": "Sources", "kind": "list", "purpose": "Mock: who to talk to.",
                 "instruction": "Mock: list the people to interview.", "required": True, "approval": ""},
                {"label": "First draft", "short_label": "Draft", "kind": "write", "purpose": "Mock: the whole piece.",
                 "instruction": "Mock: write the feature.", "required": True, "approval": ""},
                {"label": "Fact check", "short_label": "Facts", "kind": "check", "purpose": "Mock: check the claims.",
                 "instruction": "Mock: list the claims to verify.", "required": False, "approval": ""},
                {"label": "Final copy", "short_label": "Final", "kind": "write", "purpose": "Mock: ready to file.",
                 "instruction": "Mock: the final copy.", "required": True, "approval": "I approve this for publication"},
            ],
        }
    if conflicts._CONFLICT_INSTRUCTION[:60] in system:
        # "[[mock:conflict]]" in the instruction conflicts with the objective;
        # anything else is the usual answer: no conflict.
        instruction = prompt.split("--- THE NEW INSTRUCTION ---", 1)[-1]
        if "[[mock:conflict]]" in instruction:
            # Quotes the objective as listed: a conflict must quote the user's
            # own words to be kept (A1, conflicts.parse_conflicts).
            objective = next((l[len("OBJECTIVE: "):] for l in prompt.splitlines() if l.startswith("OBJECTIVE: ")), "")
            return {"conflicts": [{"kind": "objective", "with_id": "", "with_text": objective[:300] or "the project objective",
                                   "explanation": "Mock: this instruction pulls the work away from the objective."}]}
        return {"conflicts": []}
    from promptmaster import reply_actions

    if reply_actions._REPLY_ACTIONS_INSTRUCTION[:60] in system:
        # A table gets one action that changes its first row and one that adds
        # a row; a draft gets two revisions. "[[mock:no-actions]]" in the
        # question gives none (an answer that only explained).
        if "[[mock:no-actions]]" in prompt:
            return {"actions": []}
        if "[[mock:facts]]" in prompt:
            # Each sentence of the question with a figure in it, as a fact; and
            # one the user never wrote, which must be dropped.
            asked = prompt.split("--- THE USER ASKED ---", 1)[-1].split("--- THE ANSWER", 1)[0]
            sentences = [s.strip() for s in re.split(r"(?<=[.;])\s+", asked.replace("[[mock:facts]]", "")) if re.search(r"\d", s)]
            facts = [{"statement": s.rstrip(".;"), "subject": "", "kind": "fact"} for s in sentences]
            facts.append({"statement": "Candidate C managed 500 staff for 12 years", "kind": "fact"})
            return {"actions": [{"label": f"Record these {len(sentences)} facts", "kind": "record_facts", "facts": facts}]}
        ids = re.findall(r"^- id=([^:]+):", prompt, re.M)
        if ids:
            status = re.search(r"^Statuses: ([a-z_]+) ", prompt, re.M)
            first_key = re.search(r"^Columns: ([a-z_]+) ", prompt, re.M)
            update = {"id": ids[0], "fields": {first_key.group(1): "Mock: updated from the chat."}} if first_key else {"id": ids[0]}
            if status:
                update |= {"status": status.group(1), "reason": "Mock: decided in the chat."}
            return {"actions": [
                {"label": "Update the first row", "kind": "row_updates", "updates": [update, {"id": "not-a-row", "status": "x"}]},
                {"label": "Add the missing row", "kind": "add_rows",
                 "rows": [{first_key.group(1): "Mock: a row added from the chat."}] if first_key else []},
                {"label": "Rewrite it as prose", "kind": "revise", "instruction": "Mock: must be dropped on a table."},
            ]}
        # "[[mock:conflict-action]]" in the question makes the first action one
        # the conflict check objects to.
        clash = " [[mock:conflict]]" if "[[mock:conflict-action]]" in prompt else ""
        return {"actions": [
            {"label": "Tighten the opening", "kind": "revise", "instruction": f"Mock: shorten the first paragraph.{clash}"},
            {"label": "Add the missing example.", "kind": "revise", "instruction": "Mock: add one concrete example."},
        ]}
    from promptmaster import figures

    if system.startswith(figures.FIGURES_SYSTEM[:60]):
        # Every percentage in the text, plus one value that is NOT in it — the
        # parser must drop that one.
        text = prompt.split("--- THE TEXT ---", 1)[-1]
        found = re.findall(r"\d+(?:\.\d+)?%", text)
        return {"figures": [
            *[{"name": f"Mock rate {n + 1}", "value": v, "context": "scripted"} for n, v in enumerate(dict.fromkeys(found))],
            {"name": "Mock invented figure", "value": "99.9%", "context": "not in the text"},
        ]}
    if agent._PROPOSE_INSTRUCTION[:60] in system:
        # The first status offered for each row; of several, the last is left
        # out, as a row whose text does not settle it.
        ids = re.findall(r"^- id=([^:]+):", prompt.split("ROWS:", 1)[-1], re.M)
        first = re.search(r"STATUSES OFFERED:\n- ([a-z_]+):", prompt)
        return {"decisions": [{"id": i, "status": first.group(1) if first else "", "reason": "Mock: the row says so."} for i in (ids[:-1] if len(ids) > 1 else ids)]}
    if agent._TRIAGE_INSTRUCTION[:60] in system:
        ids = re.findall(r"^- id=([^:]+):", prompt.split("FINDINGS TO DECIDE:", 1)[-1], re.M)
        return {"decisions": [{"id": i, "status": "accepted", "reason": "Mock: routine, accepted."} for i in ids]}
    from promptmaster import change_impact

    if system.startswith(change_impact._IMPACT_INSTRUCTION[:60]):
        # The last finished stage relied on what changed; an invented id is added and must be dropped.
        after = prompt.split("--- AFTER ---", 1)[-1].split("FINISHED STAGES:", 1)[0].lower()
        before = prompt.split("--- BEFORE ---", 1)[-1].split("--- AFTER ---", 1)[0].lower()
        changed = sorted(set(re.findall(r"[a-z]{4,}", before)) ^ set(re.findall(r"[a-z]{4,}", after))) or ["the brief"]
        stages = re.findall(r"^- id=(\S+) — ", prompt.split("FINISHED STAGES:", 1)[-1], re.M)
        return {"kind": "fact", "calculations_hold": True,
                "affected": [{"stage_id": s, "reason": f"Mock: it relied on '{changed[0]}'."} for s in stages[-1:]] + [{"stage_id": "invented", "reason": "x"}]}
    from promptmaster import verify_sources

    if system.startswith(verify_sources._VERIFY_INSTRUCTION[:60]):
        # Every item supported, quoting the scripted abstract's second sentence.
        ids = re.findall(r"^ITEM id=(\S+)", prompt, re.M)
        return {"verdicts": [{"id": i, "verdict": "supports", "quote": "This study shows the effect holds in every case examined."} for i in ids]}
    from promptmaster import fact_extraction

    if system.startswith(fact_extraction._INSTRUCTION[:60]):
        # The first sentence with a figure in each source, as a fact quoting
        # it; and one whose quote is not in the source, which must be dropped.
        facts = []
        for m in re.finditer(r"--- SOURCE id=(\S+): [^\n]*---\n(.*?)\n--- END ---", prompt, re.S):
            sentence = next((s.strip() for s in re.split(r"(?<=[.])\s+", m.group(2)) if re.search(r"\d", s)), "")
            if sentence:
                facts.append({"statement": sentence.rstrip("."), "subject": "", "kind": "fact", "source_id": m.group(1), "quote": sentence})
                facts.append({"statement": "Revenue grew 999%", "source_id": m.group(1), "quote": "Revenue grew 999% last year."})
        return {"facts": facts}
    from promptmaster import answer_check

    if system.startswith(answer_check._INSTRUCTION[:60]):
        # A contradiction only when the answer says "[[mock:answer=contradicts]]",
        # quoting the first line of the first document; otherwise none.
        if "[[mock:answer=contradicts]]" in prompt:
            m = re.search(r"--- DOCUMENT: ([^\n(]+?)(?: \(v\d+\))? ---\n([^\n]+)", prompt)
            if m:
                return {"contradicts": True, "document": m.group(1).strip(), "quote": m.group(2).strip(),
                        "claim": "Mock: the answer says otherwise.", "explanation": "Mock: the document says this."}
        return {"contradicts": False}
    from promptmaster import objective_assessment

    if system.startswith(objective_assessment._ASSESS_INSTRUCTION[:60]):
        # Not met when the deliverable says "[[mock:objective=unmet]]": a blocker
        # and a proposal; otherwise met, quoting the deliverable's first line.
        body = prompt.split("--- THE DELIVERABLE:", 1)[-1].split("---\n", 1)[-1]
        first = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
        if "[[mock:objective=open]]" in prompt:
            # Not met, and nothing missing: another round is worth it.
            return {"outcome": "not_met", "reason": "Mock: not there yet.", "basis_quote": first[:120],
                    "blockers": [], "performed": [], "proposed_next": ["Mock: another round."]}
        if "[[mock:objective=unmet]]" in prompt:
            return {"outcome": "not_met", "reason": "Mock: the log says the criterion is not met.",
                    "basis_quote": first[:120],
                    "blockers": [{"need": "the exact formulas and their parameterisation", "kind": "source_missing"}],
                    "performed": ["S99"], "proposed_next": ["Compute the Hessian once the formulas are supplied."]}
        return {"outcome": "met", "reason": "Mock: the deliverable states the answer.", "basis_quote": first[:120],
                "blockers": [], "performed": [], "proposed_next": []}
    from promptmaster import criterion_check

    if system.startswith(criterion_check._CHECK_INSTRUCTION[:60]):
        # Met, unless the stage's text says "[[mock:criterion=unmet]]".
        if "[[mock:criterion=unmet]]" in prompt:
            return {"met": False, "reason": "Mock: the text does not say it."}
        return {"met": True, "reason": "Mock: the text states it in its second paragraph."}
    if agent._NEXT_ACTION_INSTRUCTION[:60] in system:
        return _next_action(system, prompt)
    if _STAGE_EVAL_INSTRUCTION[:60] in system:
        return _stage_evaluation(system, prompt)
    if _LIST_INSTRUCTION[:60] in system:
        return _stage_items(prompt)
    if system.startswith(setup_suggester.SETUP_SUGGESTER_SYSTEM[:60]):
        return _setup(prompt)
    if system.startswith(setup_suggester.GUIDE_NEXT_SYSTEM[:60]):
        # Two questions, the second depending on the first answer, then enough.
        answered = re.findall(r"^  A: (.*)$", prompt, re.M)
        if len(answered) == 0:
            return {"enough": False, "question": {
                "question": "What data do you have?", "why": "Mock: it decides what can be run.",
                "options": ["CRM", "Billing", "Support tickets", "None yet"], "multi": True}}
        if len(answered) == 1:
            return {"enough": False, "question": {
                "question": f"Mock follow-up on: {answered[0][:60]}", "why": "Mock: branches on the first answer.",
                "options": ["Executives", "My team"], "multi": False}}
        return {"enough": True, "reason": "Mock: that is enough to set this up."}
    if system.startswith(setup_suggester.GUIDE_QUESTIONS_SYSTEM[:60]):
        return {"questions": [
            {"id": "q1", "question": "Who is this for?", "why": "Mock: audience sets tone.",
             "options": ["Children", "Adults", "Experts"]},
            {"id": "q2", "question": "How long should it be?", "why": "Mock: length sets depth.",
             "options": ["A page", "A chapter", "A whole book"]},
            {"id": "q3", "question": "What must it include?", "why": "Mock: scope.", "options": []},
        ]}
    if system.startswith(long_form._DETECT_SYSTEM[:60]):
        return {"is_long_form": True, "suggested_section_count": 3, "reason": "Mock: multi-section."}
    if system.startswith(long_form._OUTLINE_SYSTEM[:60]):
        return _outline(prompt)
    if system.startswith(long_form._RECORD_SYSTEM[:60]):
        return _section_record()
    if system.startswith(evaluator.EVALUATOR_SYSTEM[:60]):
        return _legacy_evaluation()
    if system.startswith(audit_findings.AUDIT_FINDINGS_SYSTEM[:60]):
        return {"findings": [{"id": "f1", "category": "Clarity", "summary": "Mock finding.",
                              "suggested_change": "Mock change."}]}
    if system.startswith(continuity._SNAPSHOT_SYSTEM[:60]):
        return {"summary": "Mock snapshot.", "sections_done": [], "next": "Continue."}
    if system.startswith(guidance.GUIDANCE_SYSTEM[:60]):
        return {"suggestions": [{"text": "Mock suggestion.", "action": "Refine"}]}
    # Unknown JSON call site: an empty object. Every parser in this codebase
    # degrades on missing fields, so this surfaces as a visible default rather
    # than a crash — and a new call site should add a branch above.
    return {}


def _prose_reply(system: str, prompt: str) -> str:
    from promptmaster import agent

    if agent._WRITE_CODE_INSTRUCTION[:60] in system:
        # The objective steers the sandbox branch the E2E needs (MockRunner
        # reads these back out of the code).
        if "[[mock:sandbox=unavailable]]" in prompt:
            return "# mock:unavailable\nprint(1)"
        if "[[mock:sandbox=nodata]]" in prompt:
            return 'print("MISSING_DATA: Account-level churn records were not provided, so the cohort comparison could not be run.")\nraise SystemExit(2)'
        if "[[mock:sandbox=missing]]" in prompt:
            return "import nonexistent_lib\nprint(nonexistent_lib.x)"
        # With data attached, the scripted code reads it — so a browser test
        # can see the project's files reach the sandbox.
        attached = re.search(r"^- (/data/\S+) —", prompt, re.M)
        if attached:
            return f"import csv\nrows = list(csv.reader(open('{attached.group(1)}')))\nprint(f\"rows = {{len(rows) - 1}}\")"
        # Fenced on purpose: clean_code must strip it.
        return "```python\nresult = 2 + 2\nprint(f\"2 + 2 = {result}\")\n```"
    if agent._INTERPRET_INSTRUCTION[:60] in system:
        stdout = prompt.split("--- STDOUT ---", 1)[-1].split("--- STDERR ---", 1)[0].strip()
        return f"## Mock interpretation\n\nThe run printed `{stdout[:200]}`, which is what the computation asked for."
    if "GO MODE — PERFORM:" in system:
        move = system.split("GO MODE — PERFORM:", 1)[1].split(".", 1)[0].strip().title()
        return f"## Mock {move}\n\nScripted reasoning for this move. Nothing was run or looked up."
    from promptmaster import audit_findings

    from promptmaster import conversation

    if conversation._CHAT_REPLY_INSTRUCTION[:60] in system:
        # A discussion reply that suggests changes as a list — so the side
        # chat's "buttonize it" has points to apply.
        # Say what the chat was given, so a browser test can see the stage,
        # the outline and the chapters reached it (3 Oct call: "paste the
        # chapters back in the box").
        seen = []
        stage = re.search(r"^Current stage: (.+)$", prompt, re.M)
        if stage:
            seen.append(f"the {stage.group(1).strip()} stage")
        if "THE OUTLINE:" in prompt:
            seen.append("the outline")
        if "--- BEGIN MANUSCRIPT ---" in prompt or re.search(r"^## \d+\. ", prompt, re.M):
            seen.append("the chapters")
        where = f"Mock: I can see {', '.join(seen)}; nothing needs pasting.\n\n" if seen else ""
        return (
            where
            + "Mock reply: it reads well, but three things would help.\n\n"
            "- Mock: open with the question the reader actually has.\n"
            "- Mock: replace the abstract second paragraph with one example.\n"
            "- Mock: end on what the reader should do next.\n"
        )
    if "PromptMaster Challenge Mode" in system:
        # A critique with list items, so "buttonize it" has points to click.
        return (
            "## The case against this draft\n\n"
            "1. **Unstated assumptions** — Mock: it assumes the reader already knows the topic.\n"
            "2. **Weak reasoning** — Mock: the main claim is asserted, never shown.\n"
            "3. **Missing perspectives** — Mock: the strongest counter-argument is ignored.\n"
        )
    if audit_findings._APPLY_AUDIT_INSTRUCTION[:60] in system:
        # Apply fixes: keep the previous text and add one line per finding, so
        # a diff shows exactly what was applied (C2's review and preview).
        previous = prompt.split("PREVIOUS OUTPUT (revise this — do not repeat verbatim):\n", 1)[-1]
        previous = previous.split("\n\nFINDINGS TO ADDRESS:", 1)[0].strip()
        block = prompt.split("FINDINGS TO ADDRESS:\n", 1)[-1].split("\n\n", 1)[0]
        applied = [line.split("] ", 1)[-1].split(" → ", 1)[0] for line in block.splitlines() if line.startswith("- ")]
        return previous + "\n\n" + "\n".join(f"Applied by the mock: {a}" for a in applied)
    if "--- BEGIN SECTION ---" in prompt:
        # A Revision/Editing rewrite: name the first finding it was given, so a
        # browser test can see the findings reached the chapter.
        notes = re.search(r"leave the rest alone\):\n(.*?)\n\n", prompt, re.S)
        first = notes.group(1).splitlines()[0].strip() if notes else "(no findings)"
        return f"## Mock revision\n\nRevised by the mock model, applying: {first[:160]}"
    objective = _objective(prompt) if "Objective:" in prompt else "the task"
    if _WRITING_NOW in prompt:
        # A chapter. Say what the prompt carried, so a browser test can see
        # that the stage's own hint reached it and that the mode came as a
        # voice, not as scaffolding (2 Oct: "it really wants to make outlines").
        seen = []
        if "THIS STAGE:" in system:
            seen.append("stage hint seen")
        if "[INTERNAL SCAFFOLDING]" not in system and "You do not write final prose" not in system:
            seen.append("mode as voice only")
        note = f" ({'; '.join(seen)})" if seen else ""
        return (
            "## Mock output\n\n"
            f"This is scripted prose produced by the mock model for: {objective[:120]}{note}.\n\n"
            "It has two paragraphs so that renderers, word counts and version history "
            "have something realistic to hold. Nothing here came from a real model."
        )
    return (
        "## Mock output\n\n"
        f"This is scripted text produced by the mock model for: {objective[:120]}.\n\n"
        "It has two paragraphs so that renderers, word counts and version history "
        "have something realistic to hold. Nothing here came from a real model."
    )


class ScriptedClient(OpenRouterClient):
    """OpenRouterClient with the network replaced by scripted replies."""

    def __init__(self) -> None:
        super().__init__(api_key="mock-key-not-used", model=MOCK_MODEL)
        # How many times each counted marker (e.g. [[mock:402x1]]) has fired.
        self._fired: dict[str, int] = {}

    def _active(self, text: str) -> dict[str, int | None]:
        """Markers that should fire on this call, consuming counted ones."""
        active: dict[str, int | None] = {}
        writing_section = _WRITING_NOW in text
        for name, times, value, raw in _markers(text):
            if times is not None and not writing_section:
                continue
            if times is not None:
                fired = self._fired.get(raw, 0)
                if fired >= times:
                    continue
                self._fired[raw] = fired + 1
            active[name] = value
        return active

    async def _request_with_retries(
        self,
        payload: dict[str, Any],
        headers: dict[str, str],
        timeout: float | None,
        deadline: float | None,
    ) -> tuple[str, dict[str, int], str]:
        system, prompt = _system_and_prompt(payload)
        markers = self._active(system + "\n" + prompt)

        if "slow" in markers:
            await asyncio.sleep(markers["slow"] or 5)
        if "402" in markers:
            raise OpenRouterError(
                "OpenRouter API error 402: insufficient credits (mock)",
                status_code=402,
                provider_code="insufficient_credits",
            )
        if "429" in markers:
            raise OpenRouterError("OpenRouter API error 429: rate limited (mock)", status_code=429, retry_after=1.0)
        if "500" in markers:
            raise OpenRouterError("OpenRouter API error 500: provider error (mock)", status_code=500)

        if payload.get("response_format", {}).get("type") == "json_object":
            content = json.dumps(_json_reply(system, prompt))
        else:
            content = _prose_reply(system, prompt)

        usage = {"tokens_in": len(system + prompt) // 4, "tokens_out": len(content) // 4}
        finish_reason = "length" if "length" in markers else "stop"
        # Metered like a real call (E1), so the browser tests see usage rows;
        # the mock model has no price, so its cost is unknown, never zero.
        from promptmaster.llm_client import _meter

        _meter(model=str(payload.get("model") or MOCK_MODEL), tokens_in=usage["tokens_in"], tokens_out=usage["tokens_out"],
               elapsed=0.01, finish_reason=finish_reason)
        return content, usage, finish_reason

    @classmethod
    async def fetch_text_models(cls, api_key: str | None = None, timeout: float = 20.0) -> list[dict[str, Any]]:
        return [{"id": MOCK_MODEL, "name": "Mock (scripted)", "context_length": 128000}]
