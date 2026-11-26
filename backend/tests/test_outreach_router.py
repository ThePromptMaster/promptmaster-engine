"""Outreach email (Sean, 26 Nov): which connected mailbox sends, and as which address."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from auth import AuthUser, require_user
from deps import get_composio
from main import app
from promptmaster import composio_mock_data
from promptmaster.outreach_mail import find_key
from tests.conftest import TEST_USER_ID
from tests.test_connections_router import FakeComposio

client = TestClient(app)
SIGNED_IN = AuthUser(id=TEST_USER_ID, email="test@example.com", role="authenticated")


@pytest.fixture
def fake():
    stub = FakeComposio()
    app.dependency_overrides[get_composio] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_composio, None)


def _as(user: AuthUser):
    app.dependency_overrides[require_user] = lambda: user


def _back():
    app.dependency_overrides[require_user] = lambda: SIGNED_IN


class TestMailbox:
    def test_names_the_address_each_connected_mailbox_sends_as(self, fake):
        fake.add("acct_gmail", "gmail")
        fake.add("acct_outlook", "outlook")
        fake.add("acct_drive", "googledrive")
        r = client.get("/api/outreach/mailbox")
        assert r.status_code == 200
        assert r.json()["mailboxes"] == [
            {"toolkit": "gmail", "label": "Gmail", "connection_id": "acct_gmail", "address": composio_mock_data.MOCK_GMAIL_ADDRESS},
            {"toolkit": "outlook", "label": "Outlook", "connection_id": "acct_outlook", "address": composio_mock_data.MOCK_OUTLOOK_ADDRESS},
        ]
        # It asked the mailbox itself, and called nothing that sends.
        tools = [args[0] for kind, args in fake.calls if kind == "execute"]
        assert sorted(tools) == ["GMAIL_GET_PROFILE", "OUTLOOK_GET_PROFILE"]

    def test_only_active_mailboxes_of_the_caller(self, fake):
        fake.add("acct_old", "gmail", status="EXPIRED")
        fake.add("acct_theirs", "gmail", user_id="00000000-0000-0000-0000-000000000099")
        assert client.get("/api/outreach/mailbox").json()["mailboxes"] == []

    def test_a_mailbox_that_cannot_say_its_address_is_listed_without_one(self, fake):
        fake.add("acct_gmail", "gmail")
        fake.fail_tools.add("GMAIL_GET_PROFILE")
        assert client.get("/api/outreach/mailbox").json()["mailboxes"][0]["address"] == ""

    def test_a_guest_and_a_worker_are_refused(self, fake):
        fake.add("acct_gmail", "gmail")
        _as(AuthUser(id=TEST_USER_ID, email=None, role="authenticated", is_anonymous=True))
        try:
            assert client.get("/api/outreach/mailbox").status_code == 403
            _as(AuthUser(id=TEST_USER_ID, email=None, role="worker"))
            assert client.get("/api/outreach/mailbox").status_code == 403
        finally:
            _back()


class TestFindKey:
    """Composio documents a tool's output only as `data`, and wraps it differently by tool."""

    def test_found_wherever_it_sits(self):
        assert find_key({"emailAddress": "a@b.co"}, ("emailAddress",)) == "a@b.co"
        assert find_key({"data": {"response_data": {"emailAddress": "a@b.co"}}}, ("emailAddress",)) == "a@b.co"
        assert find_key([{"x": 1}, {"mail": "c@d.co"}], ("mail",)) == "c@d.co"

    def test_the_first_key_listed_wins_at_one_level(self):
        assert find_key({"userPrincipalName": "upn@x.co", "mail": "m@x.co"}, ("mail", "userPrincipalName")) == "m@x.co"

    def test_empty_values_are_passed_over(self):
        assert find_key({"mail": "", "nested": {"mail": "m@x.co"}}, ("mail",)) == "m@x.co"
        assert find_key({"a": None}, ("mail",)) is None


class TestSentCheck:
    """'Check whether I've already contacted them … show when I've reached somebody else at the same company.'"""

    def test_finds_people_written_to_and_colleagues_at_the_same_company(self, fake):
        fake.add("acct_gmail", "gmail")
        r = client.post("/api/outreach/sent-check", json={
            "addresses": ["Jamie.Park@northwind-holdings.example", "new.person@elsewhere.example"],
            "domains": ["harbourline-supply.example", "elsewhere.example"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["checked"] is True
        assert [s["address"] for s in body["sent"]] == ["jamie.park@northwind-holdings.example"]
        assert body["sent"][0]["subject"] == "A quick look at PromptMaster"
        assert body["sent"][0]["thread_url"] == "https://mail.google.com/mail/?authuser=you%40example.com#all/t-jamie"
        assert {c["domain"] for c in body["colleagues"]} == {"harbourline-supply.example"}
        # It searched Sent only, by the addresses and domains asked about.
        queries = [args[1]["query"] for kind, args in fake.calls if kind == "execute" and args[0] == "GMAIL_FETCH_EMAILS"]
        assert queries and all(q.startswith("in:sent to:(") for q in queries)

    def test_without_gmail_it_says_nothing_was_checked(self, fake):
        r = client.post("/api/outreach/sent-check", json={"addresses": ["a@b.co"]})
        assert r.json() == {"checked": False, "sent": [], "colleagues": []}

    def test_a_failed_search_reads_nothing_and_says_so(self, fake):
        fake.add("acct_gmail", "gmail")
        fake.fail_tools.add("GMAIL_FETCH_EMAILS")
        r = client.post("/api/outreach/sent-check", json={"addresses": ["jamie.park@northwind-holdings.example"]})
        # One search failing is logged and skipped; nothing found is reported as found.
        assert r.status_code == 200 and r.json()["sent"] == []


class TestDraftMessage:
    """'Save the standard message and let me edit individual drafts.'"""

    def _client(self, reply):
        from unittest.mock import AsyncMock

        from deps import get_client

        stub = AsyncMock()
        stub.generate_json = AsyncMock(return_value=(reply, {}))
        app.dependency_overrides[get_client] = lambda: stub
        return stub

    def teardown_method(self):
        from deps import get_client

        app.dependency_overrides.pop(get_client, None)

    def test_keeps_the_known_tokens_the_users_link_and_no_sign_off(self):
        stub = self._client({
            "subject": "{{company}} and PromptMaster",
            "body": "Hi {{first_name}},\n\n{{personal_line}}\n\nWe built {{offer}}: see {{link}} or https://evil.example/x. {{discount_code}}\n\nBest,\nSean",
            "followup_body": "Hi {{first_name}}, a quick nudge: {{link}}",
            "offer": "a beta of PromptMaster",
            "link": "https://promptmasterv1.com",
        })
        r = client.post("/api/outreach/draft-message", json={
            "inputs": {"objective": "Show the PromptMaster beta to heads of operations. Use https://promptmasterv1.com", "audience": "", "mode": "clarity"},
            "brief": "Reach the head of operations. Offer: the beta.",
        })
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["link"] == "https://promptmasterv1.com"
        assert "https://evil.example" not in m["body"] and "{{discount_code}}" not in m["body"]
        assert "{{personal_line}}" in m["body"] and "{{offer}}" in m["body"]
        assert not m["body"].rstrip().endswith("Sean")
        prompt = stub.generate_json.await_args.kwargs["prompt"]
        assert "Reach the head of operations." in prompt
        assert "No sign-off with a name" in prompt and "{{personal_line}}" in prompt

    def test_a_link_the_user_never_gave_is_not_the_link(self):
        self._client({"subject": "Hi", "body": "Hi {{first_name}}", "followup_body": "", "offer": "x", "link": "https://made-up.example"})
        r = client.post("/api/outreach/draft-message", json={"inputs": {"objective": "Reach people.", "audience": "", "mode": "clarity"}, "brief": ""})
        assert r.json()["link"] == ""
