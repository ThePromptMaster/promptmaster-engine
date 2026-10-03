"""One order for contradictions, in every prompt (3 Oct call)."""

from promptmaster.conversation import build_chat_reply_prompt
from promptmaster.long_form import build_outline_prompt
from promptmaster.precedence import PRECEDENCE, PRECEDENCE_TEXT
from promptmaster.self_model import PROMPTMASTER_SELF_MODEL


def test_the_objective_is_first_and_model_text_last():
    keys = [k for k, _ in PRECEDENCE]
    assert keys[0] == "objective" and keys[-1] == "generated"
    assert keys.index("stage") < keys.index("mode")


def test_every_path_reads_the_order_through_the_self_model(basic_inputs, basic_iteration):
    assert PRECEDENCE_TEXT in PROMPTMASTER_SELF_MODEL
    system, _ = build_chat_reply_prompt(basic_inputs, basic_iteration, [], "?", [])
    assert "1. the user's objective" in system
    assert "in the work itself, just follow it" in system


def test_a_book_objective_does_not_make_the_outline_a_book(basic_inputs):
    system, _ = build_outline_prompt(basic_inputs, 6)
    assert "outline only" in system
    assert '"write a book"' in system.lower()
