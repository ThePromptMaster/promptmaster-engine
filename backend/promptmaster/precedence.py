"""What wins when two instructions pull against each other.

The client, 3 Oct: "if there is a contradiction, does it choose the higher
one?" Until then the self-model said only that the objective wins and that a
conflict should be named "rather than silently choosing a side", which left
every other clash — a stage's instruction against a constraint, the mode
against the stage — to the model's mood. This is the one order, stated in
every prompt through the self-model, and mirrored for the conflict prompt in
`frontend/src/lib/workflow/precedence.ts` (`precedence-drift.test.ts` keeps the
two equal).

The user is still asked when their own new instruction conflicts with their
objective or an earlier decision (PM-24): the order recommends an answer there,
it does not take the choice away.
"""

from __future__ import annotations

#: Highest first. Keys are mirrored in the frontend.
PRECEDENCE: tuple[tuple[str, str], ...] = (
    ("objective", "the user's objective, in their own words — what is made, for whom and why. "
     "A particular value in it (a date, a price, a figure) gives way to an accepted fact that "
     "supersedes it: the fact is the user's later word"),
    ("decision", "decisions the user has made — accepted facts, answers to questions, approvals, choices, settled rows"),
    ("instruction", "the user's latest explicit instruction"),
    ("stage", "the current stage's instruction: what to produce now"),
    ("constraint", "the project's constraints and output format"),
    ("mode", "the mode — voice and emphasis only"),
    ("generated", "anything a model wrote earlier: summaries, drafts, suggestions"),
)

PRECEDENCE_TEXT = (
    "- When two things pull against each other, the higher one in this order wins. "
    "Follow it. In a reply to the user, say in one line which you followed and what "
    "you set aside; in the work itself, just follow it: "
    + "; ".join(f"{i}. {text}" for i, (_key, text) in enumerate(PRECEDENCE, 1))
    + ".\n"
    "- The objective says what every stage serves, not what to produce on this one. "
    "\"Write a book\" on an outline stage means: produce the outline that book needs. "
    "The chapters are written on their own stage."
)
