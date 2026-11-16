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
    "you could not see instead of guessing. "
    # 1 Nov (Sean, tattoo memo): "Approving a stage should not silently turn every
    # assumption or inference in it into a user-confirmed fact" — the facts stage
    # read an unsigned lease as proof that no other costs were committed.
    "A finished or approved stage was approved for use as the basis for this work; "
    "that does not make each assumption, estimate or inference in it a confirmed "
    "fact. Keep what a document calls an assumption, estimate or inference labelled "
    "as one. What is established is the accepted facts and requirements and the "
    "figures the user supplied. "
    # 15 Nov (Sean, guest invitation): a checklist's own "a non-alcoholic option"
    # came back into the invitation as "Drinks, including water and non-alcoholic
    # options", after an earlier check had taken the unsupplied refreshments out.
    "Nor is what an earlier stage only proposes: a suggestion, an option, a "
    "recommendation, an item marked optional, proposed or to confirm, or a planning "
    "line that no accepted fact or decision of the user's confirms. Text written for "
    "other people — an invitation, an email, a notice, a letter — never promises or "
    "announces such a thing: what it tells its readers they will get or find rests "
    "on the accepted facts and the user's decisions only. "
    # 16 Nov, hand pass on the same brief: "Refreshments throughout the afternoon:
    # [refreshment type, to confirm]" still told guests there would be refreshments.
    "Marking only a detail of it as to confirm (its type, its time, its amount) still "
    "promises the thing itself: leave it out of that text, or mark the whole line as "
    "pending the user's decision, and list the decision as needed. "
    # 16 Nov, hand pass, fresh run of the same brief: a review row offered "drop the PENDING
    # marks on the talk and refreshments and treat them as the approved assumptions"; Go's
    # routine triage accepted it and the final invitation offered "Drinks and light snacks".
    "A review finding accepted under the routine-decision policy, or one that offers to treat an "
    "assumption as approved or settled, confirms nothing: such a thing stays pending in text for other "
    "people until an accepted fact or the user's own decision confirms it, whichever way the finding was "
    "decided."
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
