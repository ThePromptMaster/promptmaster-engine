"""28 Oct (Colette, via Sean): "How cool is that?" kept coming back."""

from promptmaster.catchphrases import without_repeated_catchphrases as dedupe


def test_a_catchphrase_is_kept_the_first_time_only():
    text = "Giraffes are tall. How cool is that?\n\nTheir tongues are blue. How cool is that? They sleep standing."
    assert dedupe(text) == "Giraffes are tall. How cool is that?\n\nTheir tongues are blue. They sleep standing."


def test_one_used_in_an_earlier_reply_or_chapter_is_not_used_again():
    assert dedupe("Here is the plan. How cool is that?", ["Done! How cool is that?"]) == "Here is the plan."


def test_a_line_that_was_only_the_catchphrase_goes():
    assert dedupe("- Fact one. Wow!\n- Wow!\n- Fact two.") == "- Fact one. Wow!\n- Fact two."


def test_longer_questions_headings_tables_and_code_are_left_alone():
    text = "What would happen if the budget doubled next year?\nWhat would happen if the budget doubled next year?"
    assert dedupe(text) == text
    table = "| Wow! |\n| Wow! |\n# Wow!\n```\nWow!\nWow!\n```"
    assert dedupe(table) == table


def test_a_chat_reply_loses_a_filler_opener():
    assert dedupe("Great question! The deadline is Friday.", chat=True) == "The deadline is Friday."
    assert dedupe("Great question! The deadline is Friday.") == "Great question! The deadline is Friday."


def test_the_chat_route_drops_a_catchphrase_an_earlier_reply_used():
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from deps import get_client
    from main import app

    stub = AsyncMock()
    stub.generate = AsyncMock(return_value=("Great question! The note is ready. How cool is that?", {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/chat-message", json={
            "inputs": {"objective": "A welcome note", "audience": "", "mode": "architect"},
            "active_iteration": {"iteration_number": 1, "prompt_sent": "", "system_prompt_used": "", "output": "x", "mode": "architect"},
            "chat_history": [{"id": "a", "iteration_number": 1, "role": "assistant", "content": "Drafted. How cool is that?", "created_at": "2026-10-28T10:00:00Z"}],
            "user_message": "Anything missing?",
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    assert r.json()["assistant_message"]["content"] == "The note is ready."
