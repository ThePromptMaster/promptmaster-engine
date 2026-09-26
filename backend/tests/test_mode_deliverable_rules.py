"""Modes shape how the model thinks, never what shape the deliverable takes (PM-11, PM-16).

Architect's scaffolding said "End with a 'Next Steps' or 'Dependencies'
section", which contradicted the self-model's "produce the deliverable itself".
A Refine on the Objective stage then appended a "Next Steps" heading that the
evaluator flagged as off-format on the very next call.
"""

from __future__ import annotations

import re

from promptmaster.flow_triggers import build_refine_prompt
from promptmaster.modes import MODES


def test_no_mode_orders_an_appended_next_steps_section():
    for key, mode in MODES.items():
        scaffolding = mode.get("scaffolding", "")
        assert not re.search(r"End with (a )?'Next Steps'", scaffolding), key
        assert not re.search(r"^- End with concrete, actionable next steps", scaffolding, re.M), key


def test_refine_returns_only_the_refined_text(basic_inputs):
    _system, user = build_refine_prompt(basic_inputs, "The current draft.", "refine_shorter")
    assert "Return only the refined text itself" in user
    assert "no appended 'Next Steps' section" in user
