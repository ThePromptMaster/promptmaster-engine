"""Approving and sending outreach email (Sean, 26 Nov): the exact email approved, a ticket for it,
and the job runner sending it with that ticket, for that person only."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from auth import AuthUser, require_user
from deps import get_composio
from main import app
from promptmaster import composio_mock_data
from promptmaster.outreach_message import canonical, snapshot_hash, received_checks
from tests.conftest import TEST_USER_ID
from tests.test_connections_router import FakeComposio

client = TestClient(app)
ME = composio_mock_data.MOCK_GMAIL_ADDRESS
SIGNED_IN = AuthUser(id=TEST_USER_ID, email="test@example.com", role="authenticated")
WORKER = AuthUser(id=TEST_USER_ID, email=None, role="worker")


def snapshot(**over) -> dict:
    snap = {
        "v": 1,
        "provider": "gmail",
        "from": {"name": "Sean Moran", "address": ME},
        "reply_to": "",
        "to": ["morgan@harbourline.example"],
        "cc": [],
        "bcc": [],
        "subject": f"A quick look {uuid.uuid4().hex[:6]}",
        "html": '<div><p>Hi Morgan,</p><p>See <a href="https://promptmasterv1.com">https://promptmasterv1.com</a></p>'
        '<table><tr><td><div style="font-weight:bold">Sean Moran</div><div><img src="https://cdn.example/l/x.png" width="120"></div></td></tr></table></div>',
        "text": "Hi Morgan,\n\nSee https://promptmasterv1.com\n\n--\nSean Moran",
        "links": ["https://promptmasterv1.com"],
        "commercial": True,
        "footer": "1 Main Street\nReply unsubscribe to stop.",
        "signature_id": "sig1",
        "sender_id": "snd1",
    }
    snap.update(over)
    return snap


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("OUTREACH_TICKET_SECRET", "test-secret-not-real")
    monkeypatch.delenv("OUTREACH_SENDING", raising=False)
    stub = FakeComposio()
    stub.add("acct_gmail", "gmail")
    app.dependency_overrides[get_composio] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_composio, None)
    app.dependency_overrides[require_user] = lambda: SIGNED_IN


def as_user(user: AuthUser) -> None:
    app.dependency_overrides[require_user] = lambda: user


def ticket_for(snap: dict, purpose: str = "send") -> dict:
    as_user(SIGNED_IN)
    approval = str(uuid.uuid4())
    r = client.post("/api/outreach/tickets", json={"approvals": [{"approval_id": approval, "purpose": purpose, "snapshot": snap}]})
    assert r.status_code == 200, r.text
    out = r.json()[0]
    return {"approval_id": approval, "purpose": purpose, "snapshot": snap, "ticket": out["ticket"], "hash": out["message_hash"], "problems": out["problems"]}


class TestTickets:
    def test_an_email_that_may_go_gets_its_hash_and_ticket(self, fake):
        t = ticket_for(snapshot())
        assert t["problems"] == [] and len(t["ticket"]) == 64
        assert t["hash"] == snapshot_hash(t["snapshot"])

    @pytest.mark.parametrize(
        "over, said",
        [
            ({"from": {"name": "", "address": "someone@else.example"}}, "the connected mailbox sends as"),
            ({"to": ["a@b.example", "c@d.example"]}, "exactly one person"),
            ({"text": "Hi {{first_name}}", "html": "<p>Hi {{first_name}}</p>"}, "Still to fill in"),
            ({"footer": ""}, "postal address"),
            ({"links": ["http://insecure.example"]}, "https://"),
            ({"to": ["not-an-address"]}, "is not an email address"),
        ],
    )
    def test_what_may_not_go_says_why_and_gets_no_ticket(self, fake, over, said):
        t = ticket_for(snapshot(**over))
        assert t["ticket"] == "" and any(said in p for p in t["problems"]), t["problems"]

    def test_a_test_goes_only_to_your_own_mailbox(self, fake):
        assert ticket_for(snapshot(), purpose="test")["ticket"] == ""
        assert ticket_for(snapshot(to=[ME]), purpose="test")["ticket"] != ""

    def test_no_secret_or_the_kill_switch_means_nothing_is_ticketed(self, fake, monkeypatch):
        monkeypatch.setenv("OUTREACH_SENDING", "off")
        r = client.post("/api/outreach/tickets", json={"approvals": [{"approval_id": str(uuid.uuid4()), "snapshot": snapshot()}]})
        assert r.status_code == 503
        monkeypatch.delenv("OUTREACH_SENDING")
        monkeypatch.setenv("OUTREACH_TICKET_SECRET", "")
        assert client.post("/api/outreach/tickets", json={"approvals": [{"approval_id": str(uuid.uuid4()), "snapshot": snapshot()}]}).status_code == 503


class TestSending:
    def _send(self, t: dict, **extra):
        body = {k: t[k] for k in ("approval_id", "purpose", "snapshot", "ticket")} | extra
        return client.post("/api/outreach/send", json=body)

    def test_the_job_runner_sends_a_ticketed_email_draft_then_send_and_confirms_it(self, fake):
        t = ticket_for(snapshot())
        as_user(WORKER)
        draft = self._send(t, step="draft")
        assert draft.status_code == 200, draft.text
        sent = self._send(t, step="send", draft_id=draft.json()["draft_id"])
        assert sent.status_code == 200, sent.text
        body = sent.json()
        assert body["thread_url"].startswith("https://mail.google.com/mail/?authuser=")
        confirmed = client.post("/api/outreach/confirm", json={k: t[k] for k in ("approval_id", "purpose", "snapshot", "ticket")} | {"message_id": body["message_id"]})
        assert confirmed.json() == {"sent": True, "thread_id": body["thread_id"], "thread_url": body["thread_url"], "matches": True}
        # Gmail's own signature is never added under ours.
        create = [args[1] for kind, args in fake.calls if kind == "execute" and args[0] == "GMAIL_CREATE_EMAIL_DRAFT"]
        assert create[0]["include_signature"] is False and create[0]["is_html"] is True

    def test_a_draft_already_sent_cannot_be_sent_again(self, fake):
        t = ticket_for(snapshot())
        as_user(WORKER)
        draft_id = self._send(t, step="draft").json()["draft_id"]
        assert self._send(t, step="send", draft_id=draft_id).status_code == 200
        again = self._send(t, step="send", draft_id=draft_id)
        assert again.status_code == 502 and again.json()["detail"]["code"] == "not_sent"

    def test_before_a_retry_it_finds_the_email_in_sent(self, fake):
        t = ticket_for(snapshot())
        as_user(WORKER)
        draft_id = self._send(t, step="draft").json()["draft_id"]
        sent = self._send(t, step="send", draft_id=draft_id).json()
        found = client.post("/api/outreach/find-sent", json={k: t[k] for k in ("approval_id", "purpose", "snapshot", "ticket")} | {"after_epoch": 0})
        assert found.json()["found"] is True and found.json()["message_id"] == sent["message_id"]

    def test_a_persons_own_session_never_sends(self, fake):
        t = ticket_for(snapshot())
        as_user(SIGNED_IN)
        assert self._send(t, step="draft").status_code == 403

    def test_the_worker_without_a_valid_ticket_sends_nothing(self, fake):
        t = ticket_for(snapshot())
        as_user(WORKER)
        assert self._send(t | {"ticket": "0" * 64}, step="draft").status_code == 403
        # The approved email, changed: the ticket no longer fits it.
        assert self._send(t | {"snapshot": snapshot(subject="Something else")}, step="draft").status_code == 403
        # Another person's ticket, by the worker naming someone else.
        as_user(AuthUser(id="00000000-0000-0000-0000-000000000099", email=None, role="worker"))
        assert self._send(t, step="draft").status_code == 403

    def test_a_changed_mailbox_is_refused_and_says_so(self, fake):
        t = ticket_for(snapshot())
        as_user(WORKER)
        fake.fail_tools.add("GMAIL_GET_PROFILE")
        r = self._send(t, step="draft")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "mailbox_changed"
        # 27 Nov pass: no mailbox to read is said as that, not as a different mailbox.
        assert r.json()["detail"]["message"].startswith("Gmail is not connected")

    def test_connections_still_refuse_the_worker(self, fake):
        as_user(WORKER)
        assert client.get("/api/connections").status_code == 403
        assert client.get("/api/outreach/mailbox").status_code == 403


class TestHashAndChecks:
    def test_the_same_email_hashes_the_same_whatever_the_key_order(self):
        a = snapshot(subject="x")
        b = dict(reversed(list(a.items())))
        assert snapshot_hash(a) == snapshot_hash(b)
        assert canonical({"é": "ü"}) == '{"é":"ü"}'

    def test_a_received_test_is_checked_for_logo_signature_and_links(self):
        snap = snapshot()
        assert all(c["ok"] for c in received_checks(snap, snap["html"]))
        doubled = snap["html"] + '<div style="font-weight:bold">Sean Moran</div>'
        assert next(c for c in received_checks(snap, doubled) if c["key"] == "signature_once")["ok"] is False
        no_logo = snap["html"].replace("https://cdn.example/l/x.png", "")
        assert next(c for c in received_checks(snap, no_logo) if c["key"] == "logo")["ok"] is False
        assert received_checks(snap, "")[0]["key"] == "received"
