"""The standard outreach message (Sean, 26 Nov: "Save the standard message and let me edit individual
drafts. If I change the offer or link for a batch, show me which drafts would change").

One model call writes the subject, the body and an optional follow-up from the brief. The body keeps
the per-contact parts as tokens ({{first_name}}, {{company}}, {{personal_line}}) and the batch-wide
parts as variables ({{offer}}, {{link}}), so each email is made from it by code and a change to the
offer or the link reaches every email that has not been edited by hand.

Code checks what comes back: only the known tokens survive, a link the user never gave is removed,
and a sign-off naming the sender is taken off (the signature adds it).
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .project_context import context_block
from .reader_text import WRITING_RULES
from .schemas import PMInput
from .source_access import addresses_in, without_foreign_links

#: Filled per contact by code.
CONTACT_TOKENS = ("first_name", "company", "personal_line")
#: One value for the whole batch, changed in one place.
BATCH_TOKENS = ("offer", "link")
TOKENS = CONTACT_TOKENS + BATCH_TOKENS

MAX_BODY_WORDS = 160
_TOKEN = re.compile(r"\{\{\s*([a-zA-Z_]+)\s*\}\}")
_LINK = re.compile(r"https://[^\s<>\"')\]]+[^\s<>\"')\].,;:!?]")


class DraftedMessage(BaseModel):
    subject: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=4_000)
    followup_body: str = Field(default="", max_length=2_000)
    offer: str = Field(default="", max_length=300)
    link: str = Field(default="", max_length=500)


SYSTEM = (
    "You write short, specific outreach emails a busy person will read and answer. "
    "You never invent facts about the recipient, their company or the sender; "
    "you never promise anything the brief does not offer; and you never add a link the user did not give."
)


def build_message_prompt(inputs: PMInput, brief: str) -> str:
    """The prompt for the standard message. Asserted on in tests, never the model's output."""
    tokens = ", ".join("{{" + t + "}}" for t in TOKENS)
    return "\n\n".join(
        part
        for part in [
            context_block(inputs),
            "THE OUTREACH BRIEF (the user's, written in an earlier stage):\n" + (brief.strip() or "(none written)"),
            (
                "Write the standard first email every contact on the list will get, and a short follow-up.\n"
                f"- Use these placeholders exactly as written, and no others: {tokens}.\n"
                "- {{first_name}} in the greeting. {{personal_line}} is one sentence about the recipient's company's real work, "
                "filled in for each contact: open the body with it, on its own, and write nothing else about their company.\n"
                "- {{offer}} is what is offered and {{link}} the address to use: write each where it belongs, once. "
                "Return their values separately as `offer` and `link`: the offer in a few words, from the brief; "
                "the link exactly as the user gave it in the brief or the objective, or empty if they gave none.\n"
                f"- The body at most {MAX_BODY_WORDS - 40} words. One small, specific ask at the end (a reply, a 15-minute call).\n"
                "- No sign-off with a name, title or company: the sender's signature is added underneath.\n"
                "- The follow-up: at most 60 words, sent a few days later in the same thread if there is no reply. "
                "It may use {{first_name}} and {{link}}; it never repeats the first email.\n"
                "- Plain text. No markdown, no bullet points, no subject line in the body."
            ),
            WRITING_RULES,
            'Return JSON: {"subject": "…", "body": "…", "followup_body": "…", "offer": "…", "link": "…"}',
        ]
        if part
    )


def _known_tokens_only(text: str) -> str:
    """Placeholders the drafts do not fill are taken out rather than sent as braces."""
    return _TOKEN.sub(lambda m: "{{" + m.group(1).lower() + "}}" if m.group(1).lower() in TOKENS else "", text)


def _without_sign_off(body: str) -> str:
    """A closing line that only names someone ("Best,\\nSean", "[Your name]") goes: the signature says it."""
    lines = body.rstrip().split("\n")
    while lines and (re.fullmatch(r"\s*(\[[^\]]*\]|<[^>]*>)\s*", lines[-1]) or re.fullmatch(r"\s*[A-Z][a-z]+(?: [A-Z][a-z]+)?\s*", lines[-1])):
        lines.pop()
    return "\n".join(lines).rstrip()


def clean_message(raw: DraftedMessage, users_words: list[str]) -> DraftedMessage:
    """What the model wrote, held to the rules in code."""
    allowed = addresses_in(users_words)
    link = raw.link.strip()
    if link and (not link.startswith("https://") or link.lower().rstrip("/.,;:") not in allowed):
        link = ""
    if not link:
        found = [m for w in users_words for m in _LINK.findall(w or "")]
        link = found[0] if found else ""
    def tidy(text: str) -> str:
        return without_foreign_links(_known_tokens_only(text), allowed).strip()
    return DraftedMessage(
        subject=_known_tokens_only(raw.subject).replace("\n", " ").strip()[:200],
        body=_without_sign_off(tidy(raw.body)),
        followup_body=_without_sign_off(tidy(raw.followup_body)),
        offer=raw.offer.strip()[:300],
        link=link,
    )


async def draft_message(client: OpenRouterClient, model: str | None, inputs: PMInput, brief: str) -> tuple[DraftedMessage, dict[str, int]]:
    data, usage = await client.generate_json(prompt=build_message_prompt(inputs, brief), system=SYSTEM, temperature=0.5, model=model, max_tokens=1500)
    raw = DraftedMessage(**{k: str(data.get(k) or "") for k in DraftedMessage.model_fields})
    users_words = [inputs.objective or "", inputs.constraints or "", brief, inputs.context or ""]
    return clean_message(raw, users_words), usage
