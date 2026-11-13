"""Validation before a delegated commit (Sean, 5 Oct: "Delegation can satisfy
an authority requirement. It cannot bypass failed validation.").

A routine approval — "I am satisfied it says what success looks like" — is
something the stage's text either shows or does not. Before Go commits one
under the project's "Routine decisions: handle them for me", one small call
judges exactly that, from the text alone, and says why. A "not met" is not a
question for the user: it is work, and Go revises toward it.

Never an exit criterion itself: criteria stay pure functions (CLAUDE.md). This
is the check a policy commit must pass; the commit is recorded as the policy's.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .project_context import CHECK_CONTEXT_MAX, context_block
from .measured import MeasuredLine, measured_block
from .schemas import PMInput

#: The stage text a check reads. A routine approval is about what the stage
#: says, and the opening of a long stage says it.
MAX_CHECK_CONTENT = 24_000

_CHECK_INSTRUCTION = (
    "You check one approval on one stage of a PromptMaster project before it is "
    "committed on the user's behalf. Judge ONLY whether the stage's text, as given, "
    "satisfies the approval's statement. Do not judge whether the work is good, "
    "whether you agree with it, or anything the statement does not ask. If the text "
    "does not plainly show it, it is not met. Never treat an assumption, a guess or "
    "a placeholder as meeting it. Return JSON only."
)


class CriterionCheck(BaseModel):
    met: bool
    #: One sentence: where the text shows it, or what is missing.
    reason: str = Field(default="", max_length=400)


#: 4 Nov (production pass, Sean's support-software prompt): "I accept that the
#: memo meets the brief once these findings are applied", on a check table,
#: was judged "not met" because the table cannot show the findings applied —
#: they are applied on the next stage, which is checked there.
FINDINGS_TABLE_RULE = (
    "This stage is a table of findings about earlier work; the accepted findings are carried out on a later "
    "stage, and checked there. An approval about accepting the check's conclusions, or conditional on its "
    "findings being applied (\"once these findings are applied\", \"after these corrections\"), is met when "
    "every finding has a decision and each accepted one says what change it makes — never require the table "
    "to show the change already made."
)


#: 12 Nov (a client, an executive-search simulation): "I approve these drafts as
#: the common base for both options" was refused because the decision log said
#: "Approver: to confirm" about a plan the brief called approved and named nobody
#: for. Who approved is a record the project either has or does not have.
APPROVER_RULE = (
    "WHO APPROVED IS A RECORD, NOT THIS STAGE'S WORK. Where the project states something as approved and "
    "names nobody as approving it, text that says the approver is not specified (or not recorded) is the "
    "accurate record: not a placeholder, and never a reason for \"not met\". Never require the text to name "
    "an approver the project does not name."
)


def setup_block(inputs: PMInput) -> str:
    """The project's setup, which the stage's text is written to follow (4 Nov).

    Production pass of Sean's support-software prompt: the brief said
    "Audience: Executive", the setup's own audience. The check was shown the
    objective and the user's material, not the setup, so it read the audience
    as invented — "not met" twice, the brief revised twice, then Go stopped.
    """
    fields = [
        ("Audience", inputs.audience),
        ("Constraints", inputs.constraints),
        ("Output format", inputs.output_format),
    ]
    lines = [f"{name}: {' '.join(str(value).split())[:1_500]}" for name, value in fields if str(value or "").strip()]
    if not lines:
        return ""
    return (
        "THE PROJECT'S SETUP (settled in the project; text that follows it is not invented and is never a "
        "reason for \"not met\", even where the user's own material does not say it):\n" + "\n".join(lines) + "\n"
    )


def build_check_prompt(
    inputs: PMInput, stage_label: str, criterion: str, content: str,
    measured: list[MeasuredLine] | None = None, findings_table: bool = False,
) -> tuple[str, str]:
    text = content.strip()
    if len(text) > MAX_CHECK_CONTENT:
        # Said so it is not read as a gap in the work (12 Oct, Northstar; 13 Oct).
        text = text[:MAX_CHECK_CONTENT] + (
            "\n[The rest of the stage is not shown here, for length. It exists; never "
            "report anything as missing, cut off or truncated because of this note.]"
        )
    user = (
        f"PROJECT OBJECTIVE: {inputs.objective}\n"
        + setup_block(inputs)
        + (f"{context_block(inputs, limit=CHECK_CONTEXT_MAX)}\n" if context_block(inputs) else "")
        + f"STAGE: {stage_label}\n"
        + f"{APPROVER_RULE}\n"
        + (f"{FINDINGS_TABLE_RULE}\n" if findings_table else "")
        + (f"{measured_block(measured)}\n" if measured else "")
        + f"THE APPROVAL, as the user would state it: \"{criterion}\"\n\n"
        f"--- THE STAGE'S TEXT ---\n{text}\n--- END ---\n\n"
        'Return JSON: {"met": true|false, "reason": "one sentence — where the text shows it, or what is missing"}'
    )
    return _CHECK_INSTRUCTION, user


def parse_check(result: object) -> CriterionCheck:
    """Anything but an explicit true is "not met": a commit needs a yes."""
    if not isinstance(result, dict):
        return CriterionCheck(met=False, reason="The check did not come back in a usable form.")
    reason = " ".join(str(result.get("reason") or "").split())[:400]
    return CriterionCheck(met=result.get("met") is True, reason=reason or "No reason was given.")


async def check_criterion(
    client: OpenRouterClient, model: str | None, inputs: PMInput, stage_label: str, criterion: str, content: str,
    measured: list[MeasuredLine] | None = None, findings_table: bool = False,
) -> CriterionCheck:
    system, user = build_check_prompt(inputs, stage_label, criterion, content, measured, findings_table)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=300, model=model)
    return parse_check(result)
