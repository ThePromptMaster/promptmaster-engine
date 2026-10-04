"""The side chat is told where the user is (3 Oct call).

Given only the brief and the text on screen, the chat asked the user to paste
the outline and the chapters back, and named buttons the page did not have.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.conversation import (
    build_apply_to_answer_prompt,
    build_chat_reply_prompt,
    build_save_as_new_version_prompt,
)
from promptmaster.page_context import ChatContext, PageButton, format_chat_context
from promptmaster.schemas import StageDigestEntry

CONTEXT = ChatContext(
    stage_label="Continuity",
    stage_instruction="List continuity problems across the chapters.",
    workflow_label="Book",
    workflow_stages=["Objective", "Outline", "Drafting", "Continuity", "Final review"],
    prior_stages=[StageDigestEntry(stage_id="objective", label="Objective", summary="A book about lions.")],
    outline="1. The pride — how lions live together\n2. The hunt — who hunts and why",
    manuscript="## The pride\nLions live in prides of up to thirty.",
    buttons=[PageButton(label="Draft this stage", where="the main button at the bottom of the stage")],
)


def test_context_block_carries_stage_workflow_outline_chapters_and_buttons():
    block = format_chat_context(CONTEXT)
    assert "Current stage: Continuity" in block
    assert "[Continuity]" in block and "Drafting" in block
    assert "Objective: A book about lions." in block
    assert "1. The pride — how lions live together" in block
    assert "Lions live in prides of up to thirty." in block
    assert '"Draft this stage"' in block
    assert "never ask" in block.lower() and "paste" in block.lower()


def test_no_context_means_the_old_prompt():
    assert format_chat_context(None) == ""


def test_unknown_buttons_forbid_naming_any():
    block = format_chat_context(ChatContext(stage_label="Approval"))
    assert "not known. Do not name any button." in block


def test_empty_buttons_forbid_naming_any():
    block = format_chat_context(ChatContext(stage_label="Approval", buttons=[]))
    assert "none. Do not name any button." in block


@pytest.mark.parametrize("builder", ["chat", "apply", "save"])
def test_every_chat_flow_carries_the_context(builder, basic_inputs, basic_iteration):
    if builder == "chat":
        system, user = build_chat_reply_prompt(basic_inputs, basic_iteration, [], "Where is chapter 2?", [], CONTEXT)
    elif builder == "apply":
        system, user = build_apply_to_answer_prompt(basic_inputs, basic_iteration, [], [], CONTEXT)
    else:
        system, user = build_save_as_new_version_prompt(basic_inputs, basic_iteration, [], [], CONTEXT)
    assert "WHERE THE USER IS" in user
    assert "Lions live in prides" in user
    assert "paste" in system.lower()  # the self-model's never-paste line


def test_chat_message_endpoint_sends_the_context_to_the_model(basic_inputs, basic_iteration):
    stub = AsyncMock()
    stub.generate = AsyncMock(return_value=("Chapter 2 is The hunt.", {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post(
            "/api/chat-message",
            json={
                "inputs": basic_inputs.model_dump(),
                "active_iteration": basic_iteration.model_dump(),
                "user_message": "What is chapter 2 about?",
                "context": CONTEXT.model_dump(),
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    prompt = stub.generate.call_args.kwargs["prompt"]
    assert "2. The hunt — who hunts and why" in prompt
    assert '"Draft this stage"' in prompt


def test_chat_message_without_context_still_works(basic_inputs, basic_iteration):
    stub = AsyncMock()
    stub.generate = AsyncMock(return_value=("Sure.", {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post(
            "/api/chat-message",
            json={
                "inputs": basic_inputs.model_dump(),
                "active_iteration": basic_iteration.model_dump(),
                "user_message": "Hi",
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    assert "WHERE THE USER IS" not in stub.generate.call_args.kwargs["prompt"]
