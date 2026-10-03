"""Tests for conversation prompt builders."""

from promptmaster.conversation import (
    build_apply_to_answer_prompt,
    build_chat_reply_prompt,
    build_save_as_new_version_prompt,
)
from promptmaster.schemas import ChatMessage


def _chat() -> list[ChatMessage]:
    return [
        ChatMessage(id="1", iteration_number=1, role="user", content="Make it shorter.", created_at="t"),
        ChatMessage(id="2", iteration_number=1, role="assistant", content="Sure.", created_at="t"),
    ]


# --- chat-reply ---

def test_chat_reply_includes_objective_and_output(basic_inputs, basic_iteration):
    system, user = build_chat_reply_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        user_message="What about the timeline?",
        iterations=[basic_iteration],
    )
    assert basic_inputs.objective in user
    assert basic_iteration.output in user


def test_chat_reply_includes_user_message(basic_inputs, basic_iteration):
    _, user = build_chat_reply_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=[],
        user_message="What about the timeline?",
        iterations=[basic_iteration],
    )
    assert "timeline" in user


def test_chat_reply_includes_chat_history(basic_inputs, basic_iteration):
    _, user = build_chat_reply_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        user_message="...",
        iterations=[basic_iteration],
    )
    assert "Make it shorter" in user


def test_chat_reply_system_includes_session_history(basic_inputs, basic_iteration):
    system, _ = build_chat_reply_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=[],
        user_message="...",
        iterations=[basic_iteration],
    )
    assert "Session history" in system or "iteration" in system.lower()


# --- apply-to-answer ---

def test_apply_to_answer_includes_objective_and_output(basic_inputs, basic_iteration):
    _, user = build_apply_to_answer_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        iterations=[basic_iteration],
    )
    assert basic_inputs.objective in user
    assert basic_iteration.output in user


def test_apply_to_answer_includes_chat(basic_inputs, basic_iteration):
    _, user = build_apply_to_answer_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        iterations=[basic_iteration],
    )
    assert "Make it shorter" in user


def test_apply_to_answer_system_instructs_to_revise(basic_inputs, basic_iteration):
    system, _ = build_apply_to_answer_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        iterations=[basic_iteration],
    )
    assert "revise" in system.lower() or "update" in system.lower()


# --- save-as-new-version ---

def test_save_as_new_version_revises_the_current_text(basic_inputs, basic_iteration):
    """The new version starts from what is there. Withholding it made the model
    rewrite from the brief and the thread, and lose what the chat never mentioned."""
    system, user = build_save_as_new_version_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        iterations=[basic_iteration],
    )
    assert basic_inputs.objective in user
    assert "Make it shorter" in user
    assert basic_iteration.output in user
    assert "keep the rest" in system.lower()


def test_save_as_new_version_system_instructs_fresh_generation(basic_inputs, basic_iteration):
    system, _ = build_save_as_new_version_prompt(
        inputs=basic_inputs,
        active_iteration=basic_iteration,
        chat_history=_chat(),
        iterations=[basic_iteration],
    )
    assert "fresh" in system.lower() or "new" in system.lower()
