"""Tests for conversation prompt builders."""

from promptmaster.conversation import (
    build_apply_to_answer_prompt,
    build_chat_reply_prompt,
    build_save_as_new_version_prompt,
)
from promptmaster.page_context import ChatContext, GoRunTrace, format_chat_context, format_go_run
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


def test_the_chat_is_given_go_s_run_record_and_may_not_infer_a_stop_reason():
    """6 Oct, email 10: asked why Go stopped, the chat first said external
    validation was required — an inference — and then that it could not see
    the run. It is now given the run record, and told to answer from it."""
    from promptmaster.page_context import ChatContext, GoRunTrace, GoStepTrace, format_chat_context, format_go_run

    ctx = ChatContext(stage_label="Final", go_run=GoRunTrace(
        status="blocked", policy="autonomous",
        stop_reason="Paused — the objective is not met. Waiting for: the exact formulas.",
        steps=[GoStepTrace(action="run_computation", status="failed", execution_label="blocked", block_kind="data_missing")],
        objective="not met — the log says the criterion is not met.",
    ))
    text = format_chat_context(ctx)
    assert "GO'S LATEST RUN: blocked (autonomous)" in text
    assert "Recorded stop reason: Paused — the objective is not met" in text
    assert "run_computation [failed; blocked, blocked: data_missing]" in text
    assert "never offer an inference as the reason" in text
    assert "Never say you updated, recorded or saved anything" in text
    assert "GO: no run on this project yet." in format_chat_context(ChatContext(stage_label="Final"))


def test_a_change_the_user_asks_for_is_later_than_an_older_fact(basic_inputs, basic_iteration):
    """Sean, 10 Oct (emails 4–5): Change it to Wednesday at 1:00 p.m. came back
    still saying Thursday at 12:30, the value the facts and the objective held."""
    from promptmaster.conversation import build_apply_to_answer_prompt
    from promptmaster.project_context import FACTS_HEADER

    system, _user = build_apply_to_answer_prompt(basic_inputs, basic_iteration, [], [])
    assert "THE USER'S INSTRUCTION IN THE CHAT IS THEIR LATEST WORD" in system
    assert "write the instruction's value" in system
    assert "a change the user is asking for right now, in their own words in the side chat" in FACTS_HEADER


class TestChatReadsTheRunRecord:
    """5 Nov (a research project): the chat said nothing had been run, then that Go was
    still running, and only then what had happened."""

    def test_says_how_far_along_it_is(self):
        run = GoRunTrace(status="blocked", policy="autonomous", from_record=True, moves=24, cost_usd=12.16, last_activity_minutes=3)
        said = format_go_run(run)
        assert "Read from the run record just now: 24 moves; $12.16 so far; last activity 3 minutes ago." in said

    def test_running_with_nothing_happening_is_not_said_to_be_working(self):
        said = format_go_run(GoRunTrace(status="running", from_record=True, last_activity_minutes=40))
        assert "nothing has happened for 40 minutes" in said
        assert "do not say it is working" in said
        assert "nothing has happened" not in format_go_run(GoRunTrace(status="running", from_record=True, last_activity_minutes=1))

    def test_a_tabs_memory_makes_no_such_claim(self):
        assert "Read from the run record" not in format_go_run(GoRunTrace(status="running"))

    def test_a_failed_read_never_reads_as_no_run(self):
        assert format_go_run(None) == "GO: no run on this project yet."
        said = format_go_run(None, read=False)
        assert "could not be read" in said and "do not say it has not run" in said
        assert "could not be read" in format_chat_context(ChatContext(stage_label="Final", go_run_read=False))


class TestChatAttachments:
    """5 Nov (a book test): eleven screenshots uploaded in the side chat, and it answered
    "No, no photos came through … the Data panel shows nothing new"."""

    def test_a_document_is_read_and_an_image_is_named(self):
        from promptmaster.conversation import attached_block
        from promptmaster.page_context import ChatAttachment

        block = attached_block([
            ChatAttachment(name="notes.docx", text="The launch moved."),
            ChatAttachment(name="IMG_1.png", image="data:image/jpeg;base64,AAAA"),
        ])
        assert "### From notes.docx" in block and "The launch moved." in block
        assert "IMG_1.png: an image, shown to you with this message" in block

    def test_too_much_for_one_message_is_named_and_said(self):
        from promptmaster.conversation import attached_block
        from promptmaster.page_context import ChatAttachment

        block = attached_block([ChatAttachment(name="IMG_12.png", not_read=True)])
        assert "too much for one message" in block and "IMG_12.png" in block
        assert attached_block([]) == ""

    def test_only_an_image_data_url_is_accepted(self):
        import pytest as _pytest
        from pydantic import ValidationError

        from promptmaster.page_context import ChatAttachment

        assert ChatAttachment(name="a", image="data:image/png;base64,AAAA").image
        with _pytest.raises(ValidationError):
            ChatAttachment(name="a", image="https://example.com/a.png")

    def test_the_projects_files_are_named_and_said_to_be_there(self):
        from promptmaster.page_context import ProjectFileBrief

        said = format_chat_context(ChatContext(stage_label="Final", files=[ProjectFileBrief(name="IMG_1.png", note="an image")]))
        assert "FILES IN THIS PROJECT'S DATA PANEL" in said
        assert "IMG_1.png: an image" in said
        assert "never say one is not there" in said
        assert "DATA PANEL" not in format_chat_context(ChatContext(stage_label="Final"))
