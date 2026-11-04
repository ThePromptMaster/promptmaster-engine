"""Who may trigger a simulated failure on production (4 Nov).

Sean wants to test, on production, that a check which comes back empty is
reported as not run, keeps the last check that did run, and can be run again.
A real empty check cannot be triggered on demand, so a stage check may be
sent with `simulate: "empty"`, and the server answers it exactly as it answers
a real empty reply at the token limit — without calling a model.

Only for the user ids in `SIMULATE_FAILURE_USER_IDS` (comma-separated, read on
every call). Unset or empty means no one: a missing variable must never mean
"anyone may".
"""

from __future__ import annotations

import os


def simulation_user_ids() -> set[str]:
    return {x.strip() for x in os.getenv("SIMULATE_FAILURE_USER_IDS", "").split(",") if x.strip()}


def simulation_allowed(user: object | None) -> bool:
    user_id = getattr(user, "id", None)
    return bool(user_id) and user_id in simulation_user_ids()
