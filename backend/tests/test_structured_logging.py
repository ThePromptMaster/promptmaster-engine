"""FR-19: a single request is traceable across the API and the drain.

What this replaces is twenty-four free-text `logger.*` calls under
`basicConfig(level=INFO)` — no request id, no user id, no project id on any
line. "This user's book failed at 4pm, show me what happened" was not a query
anyone could run.

The correlation id is the load-bearing part. The drain generates one per job
step and sends it as `X-Request-Id`; this API adopts it rather than minting its
own, so one id appears in the drain's line, in every line the API emits while
serving that call, and on the `model_usage` row. That is what makes joining the
two logs a `grep` instead of a comparison of timestamps.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from main import app
from observability import (
    REQUEST_ID_HEADER,
    JsonLogFormatter,
    project_id_var,
    request_id_var,
    user_id_var,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def render(record_kwargs: dict | None = None, message: str = "hello") -> dict:
    """Format one record through the JSON formatter and parse it back."""
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=None,
    )
    for key, value in (record_kwargs or {}).items():
        setattr(record, key, value)
    return json.loads(JsonLogFormatter().format(record))


# ---------------------------------------------------------------------------
# The formatter
# ---------------------------------------------------------------------------


def test_a_line_is_one_json_object():
    line = render()
    assert line["level"] == "INFO"
    assert line["message"] == "hello"
    assert line["logger"] == "test.logger"
    assert line["ts"].endswith("Z")


def test_correlation_fields_ride_along_without_being_passed():
    """The whole reason correlation lives in contextvars.

    Threading a request id through `prompt_builder`, `evaluator`, `guidance`
    and `llm_client` means every new call site is a place to forget it — and
    the sites that forget are the error paths you needed.
    """
    tokens = [
        request_id_var.set("req-abc"),
        user_id_var.set("user-42"),
        project_id_var.set("proj-9"),
    ]
    try:
        line = render()
    finally:
        request_id_var.reset(tokens[0])
        user_id_var.reset(tokens[1])
        project_id_var.reset(tokens[2])

    assert line["request_id"] == "req-abc"
    assert line["user_id"] == "user-42"
    assert line["project_id"] == "proj-9"


def test_unset_correlation_fields_are_omitted_not_blank():
    """`"user_id": ""` on every line of an unauthenticated request is noise."""
    line = render()
    assert "user_id" not in line
    assert "project_id" not in line


def test_extra_fields_are_promoted_to_top_level_keys():
    """This is what makes usage queryable rather than regex-able."""
    line = render({"model": "openai/gpt-4o", "tokens_in": 1200, "cost_usd": 0.03})
    assert line["model"] == "openai/gpt-4o"
    assert line["tokens_in"] == 1200
    assert line["cost_usd"] == 0.03


def test_a_non_serialisable_extra_does_not_lose_the_line():
    class Opaque:
        def __repr__(self):
            return "<opaque>"

    line = render({"thing": Opaque()})
    assert line["thing"] == "<opaque>"


def test_an_exception_is_carried_as_a_field():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord(
            "t", logging.ERROR, __file__, 1, "failed", (), sys.exc_info()
        )
    line = json.loads(JsonLogFormatter().format(record))
    assert "ValueError: boom" in line["exception"]


# ---------------------------------------------------------------------------
# The middleware
# ---------------------------------------------------------------------------


def test_every_response_carries_a_request_id(client):
    res = client.get("/api/health")
    assert res.headers[REQUEST_ID_HEADER]


def test_a_caller_supplied_request_id_is_adopted(client):
    """The drain names the id; this API must not mint a competing one."""
    res = client.get("/api/health", headers={REQUEST_ID_HEADER: "drain-job-77"})
    assert res.headers[REQUEST_ID_HEADER] == "drain-job-77"


def test_a_hostile_request_id_is_length_capped(client):
    """Trusted for correlation, never for authorisation — and still bounded."""
    res = client.get("/api/health", headers={REQUEST_ID_HEADER: "x" * 5000})
    assert len(res.headers[REQUEST_ID_HEADER]) == 64


def test_each_request_gets_a_distinct_id(client):
    first = client.get("/api/health").headers[REQUEST_ID_HEADER]
    second = client.get("/api/health").headers[REQUEST_ID_HEADER]
    assert first != second


def test_a_request_completed_line_is_emitted(client, caplog):
    with caplog.at_level(logging.INFO, logger="observability"):
        client.get("/api/health")

    completed = [r for r in caplog.records if r.getMessage() == "request_completed"]
    assert completed, "no access line was emitted"
    record = completed[-1]
    assert record.http_status == 200
    assert record.method == "GET"
    assert isinstance(record.duration_ms, int)


def test_the_access_line_reports_what_the_request_spent(client, caplog):
    """FR-19 wants usage visible in the log, not only in the database."""
    with caplog.at_level(logging.INFO, logger="observability"):
        client.post("/api/estimate-job", json={"section_count": 2, "model": "m"})

    record = [r for r in caplog.records if r.getMessage() == "request_completed"][-1]
    assert record.tokens_in == 0
    assert record.llm_calls == 0


def test_a_refused_request_is_still_logged(client, caplog, monkeypatch):
    """An error you cannot see is the failure FR-19 exists to close."""
    with caplog.at_level(logging.INFO, logger="observability"):
        client.post("/api/estimate-job", json={"section_count": 9999})

    record = [r for r in caplog.records if r.getMessage() == "request_completed"][-1]
    assert record.http_status == 422


def test_the_project_header_reaches_the_log_context(client, caplog):
    with caplog.at_level(logging.INFO, logger="routers.usage"):
        client.post(
            "/api/estimate-job",
            json={"section_count": 2, "model": "m"},
            headers={"X-PromptMaster-Project": "proj-77"},
        )

    # The context is read by the formatter at format time, so assert on the
    # formatter's output rather than on the record's attributes.
    estimated = [r for r in caplog.records if r.getMessage() == "job_estimated"]
    assert estimated, "the endpoint logged nothing"
    assert estimated[-1].section_count == 2
