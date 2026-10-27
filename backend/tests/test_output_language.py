"""A project's output language reaches every model call (client, 21 Oct: "Can we do pick your language?")."""

import json

import httpx
from fastapi.testclient import TestClient

from observability import LANGUAGE_HEADER, language_var
from promptmaster.language import LANGUAGES, language_directive, resolve
from promptmaster.llm_client import _REPAIRING, OpenRouterClient, _with_language


def test_english_adds_nothing_and_unknown_codes_are_english():
    assert language_directive("en") == ""
    assert language_directive(None) == ""
    assert resolve("ja") == "en"
    assert resolve("es-MX") == "es"
    assert resolve("FR") == "fr"


def test_the_directive_names_the_language_and_keeps_quotes_figures_and_json_fixed():
    d = language_directive("es")
    assert "Spanish (español)" in d
    assert "quotations, figures" in d
    assert "keys and fixed values" in d
    for code in LANGUAGES:
        assert (language_directive(code) == "") == (code == "en")


def test_the_directive_joins_the_system_message_or_becomes_one():
    token = language_var.set("fr")
    try:
        with_system = _with_language([{"role": "system", "content": "You are an editor."}, {"role": "user", "content": "Hi"}])
        assert with_system[0]["content"].startswith("You are an editor.")
        assert "French (français)" in with_system[0]["content"]
        assert with_system[1] == {"role": "user", "content": "Hi"}

        bare = _with_language([{"role": "user", "content": "Hi"}])
        assert bare[0]["role"] == "system" and "French" in bare[0]["content"]
        assert bare[1]["content"] == "Hi"
    finally:
        language_var.reset(token)


def test_english_and_json_repairs_are_left_alone():
    messages = [{"role": "user", "content": "Hi"}]
    assert _with_language(messages) == messages  # default: English
    lang = language_var.set("de")
    rep = _REPAIRING.set(True)
    try:
        assert _with_language(messages) == messages
    finally:
        _REPAIRING.reset(rep)
        language_var.reset(lang)


async def test_every_call_sends_it_to_the_provider():
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        })

    client = OpenRouterClient(api_key="k")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    token = language_var.set("pt")
    try:
        await client.generate("Write", system="Be brief.")
        await client.generate_with_meta("Write")
        await client.generate_json("Score it")
    finally:
        language_var.reset(token)
    assert len(sent) == 3
    for payload in sent:
        assert "Portuguese (português)" in payload["messages"][0]["content"]


def test_the_header_sets_the_language_for_the_request():
    from fastapi import FastAPI

    from observability import ObservabilityMiddleware

    app = FastAPI()
    app.add_middleware(ObservabilityMiddleware)

    @app.get("/lang")
    async def lang():
        return {"language": language_var.get()}

    client = TestClient(app)
    assert client.get("/lang", headers={LANGUAGE_HEADER: "es"}).json() == {"language": "es"}
    assert client.get("/lang", headers={LANGUAGE_HEADER: "klingon"}).json() == {"language": "en"}
    assert client.get("/lang").json() == {"language": "en"}


def test_the_new_languages_resolve_exactly():
    """Sean, 24 Oct: Hindi, Mandarin, Arabic, Swahili."""
    for code in ("hi", "zh", "ar", "sw"):
        assert resolve(code) == code
    assert resolve("zh-CN") == "zh"
    assert resolve("en-GB") == "en"


def test_african_american_english_is_withdrawn():
    """Sean, 27 Oct: "take off African American language for the time being" (L-110).
    A project saved with it writes in English."""
    assert resolve("en-aave") == "en"
    assert language_directive("en-aave") == ""


def test_chinese_limits_are_characters():
    assert "字" in language_directive("zh") and "Simplified" in language_directive("zh")
    assert "हिन्दी" in language_directive("hi")
