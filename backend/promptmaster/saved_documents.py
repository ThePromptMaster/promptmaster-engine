"""The earlier stages' saved documents, as one block every stage prompt shares.

Until 8 Oct a later stage saw each earlier one as a summary of at most 320
characters, written once when that stage was completed. A consistency check
then reported facts "missing" from an FAQ it had only seen an excerpt of, a
research report's Results said every cycle was "not run" while the Analysis
stage held the proofs, and a final review kept judging Output v1 after the user
had saved v2. The client now sends each earlier stage's latest saved text
(digest.ts, DOCUMENTS_MAX); this renders it, and says what it is.
"""

from __future__ import annotations

from .schemas import StageDigest

DOCUMENTS_RULE = (
    "These are the project's saved documents — the record. When you say what an "
    "earlier stage contains, base it on the text shown here, quoting it where it "
    "matters; never infer content from a summary or from what the stage was meant "
    "to produce. Where a document is marked as cut or as a summary only, say what "
    "you could not see instead of guessing."
)


def format_prior_documents(digest: StageDigest, empty: str = "(nothing completed before this stage)") -> str:
    """Each earlier stage, in order: its full saved text where sent, else its summary."""
    if not digest.prior_stages:
        return empty
    blocks: list[str] = []
    any_text = False
    for entry in digest.prior_stages:
        label = entry.label or entry.stage_id
        text = entry.text.strip()
        if text:
            any_text = True
            version = f" — v{entry.version}" if entry.version else ""
            cut = " (cut to fit; the rest is not shown)" if entry.truncated else ""
            blocks.append(f"### {label}{version}{cut}\n--- BEGIN SAVED DOCUMENT ---\n{text}\n--- END SAVED DOCUMENT ---")
        else:
            # A stage with no saved text (or one past the budget) keeps the
            # one-line form every prompt used before.
            summary = entry.summary.strip() or "(no summary recorded)"
            blocks.append(f"- {label}: {summary}")
    if any_text:
        blocks.insert(0, DOCUMENTS_RULE)
    return "\n\n".join(blocks)
