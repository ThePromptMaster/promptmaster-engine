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
