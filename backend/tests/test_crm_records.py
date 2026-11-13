"""Salesforce and HubSpot records through Composio (13 Nov): read only, a fixed list of fields, ids checked."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from deps import get_composio
from main import app
from promptmaster import account_search, composio_mock_data
from promptmaster.account_search import SEARCHES, Search, _newest_of_each, search_everything, sosl_for
from promptmaster.connections import (
    _VALID,
    HUBSPOT,
    HUBSPOT_OBJECTS,
    MAX_RECORDS,
    PREVIEWS,
    PROVIDER,
    SALESFORCE,
    SALESFORCE_OBJECTS,
    TOOLKITS,
    PickedItem,
    PreviewItem,
    hubspot_items,
    ordered,
    preview,
    read,
    salesforce_fields,
    salesforce_items,
)
from promptmaster.schemas import ThirdPartyItem
from routers import agent as agent_router
from tests.conftest import TEST_USER_ID
from tests.test_connections_router import ORIGIN, FakeComposio

NOW = datetime(2026, 11, 13, 12, tzinfo=timezone.utc)
OPPORTUNITY = "Opportunity:006Hs00000A1b2cIAB"
client = TestClient(app)


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", f"{ORIGIN},http://localhost:3000")
    stub = FakeComposio()
    stub.add("acc-sf", SALESFORCE)
    stub.add("acc-hs", HUBSPOT)
    app.dependency_overrides[get_composio] = lambda: stub
    yield stub
    app.dependency_overrides.pop(get_composio, None)


def _calls(fake: FakeComposio, tool: str) -> list[dict[str, Any]]:
    return [args for kind, payload in fake.calls if kind == "execute" for name, args in [payload] if name == tool]


def test_every_toolkit_has_a_provider_a_preview_a_search_and_something_it_reads():
    """A slug with no preview or search is a 500 the moment the accounts page opens."""
    assert set(TOOLKITS) == set(PROVIDER) == set(PREVIEWS) == set(SEARCHES)
    assert {toolkit for toolkit, _kind in _VALID} == set(TOOLKITS)
    assert PROVIDER[SALESFORCE] != PROVIDER[HUBSPOT]
    assert TOOLKITS[SALESFORCE].label == "Salesforce" and TOOLKITS[HUBSPOT].label == "HubSpot"


def test_a_crm_record_is_a_kind_a_project_can_hold():
    held = ThirdPartyItem(kind="crm_record", source="Salesforce · Opportunity", title="Northwind renewal", text="Stage: Negotiation")
    assert held.kind == "crm_record"


def test_salesforce_records_say_their_own_kind_and_carry_it_in_their_id():
    found = salesforce_items(composio_mock_data.result("SALESFORCE_POST_PARAMETERIZED_SEARCH", {"q": "Northwind"}))
    assert [(i.id, i.detail, i.kind, i.toolkit) for i in found] == [
        (OPPORTUNITY, "Opportunity", "crm_record", SALESFORCE),
        ("Account:001Hs00000Z9y8xIAB", "Account", "crm_record", SALESFORCE),
        ("Contact:003Hs00000Q7w6vIAB", "Contact", "crm_record", SALESFORCE),
    ]
    assert found[0].title == "Northwind Holdings renewal" and found[0].ref == {"object": "Opportunity"}
    # A query of one kind may come back without the type on each row.
    bare = {"records": [{"Id": "006Hs00000A1b2cIAB", "Name": "Renewal", "LastModifiedDate": "2026-11-12T10:00:00.000+0000"}]}
    assert salesforce_items(bare) == []
    assert salesforce_items(bare, default="Opportunity")[0].id == OPPORTUNITY
    # Something that is not a Salesforce id, or a kind PromptMaster does not read, is left out.
    assert salesforce_items({"records": [{"attributes": {"type": "Lead"}, "Id": "00QHs00000A1b2cIAB", "Name": "x"},
                                         {"attributes": {"type": "Contact"}, "Id": "'; DROP", "Name": "y"}]}) == []
    many = {"searchRecords": [{"attributes": {"type": "Contact"}, "Id": f"003Hs00000Q7w6{n:04d}", "Name": f"Person {n}"} for n in range(30)]}
    assert len(salesforce_items(many)) == MAX_RECORDS


def test_hubspot_numbers_each_kind_apart_so_the_id_says_which():
    deal = hubspot_items("deal")(composio_mock_data.result("HUBSPOT_SEARCH_DEALS", {"query": "lease"}))
    company = hubspot_items("company")(composio_mock_data.result("HUBSPOT_SEARCH_COMPANIES", {"query": "Okafor"}))
    contact = hubspot_items("contact")(composio_mock_data.result("HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", {"query": "Okafor"}))
    assert (deal[0].id, company[0].id) == ("deal:9001", "company:9001")
    assert deal[0].title == "Okafor Estates lease renewal" and deal[0].detail == "Deal"
    assert (contact[0].title, contact[0].who, contact[0].detail) == ("Sam Okafor", "Okafor Estates", "Contact")
    # A flat answer, and one whose id is not a number.
    assert hubspot_items("deal")({"results": [{"hs_object_id": "77", "dealname": "Flat deal"}]})[0].id == "deal:77"
    assert hubspot_items("deal")({"results": [{"id": "abc", "properties": {"dealname": "x"}}]}) == []


@pytest.mark.asyncio
async def test_a_search_reaches_both_crms_with_the_words_alone(fake):
    found, problems = await search_everything(fake, TEST_USER_ID, [SALESFORCE, HUBSPOT], Search(words="Northwind renewal"), NOW)
    assert problems == []
    assert [i.id for i in found] == [OPPORTUNITY]
    [sent] = _calls(fake, "SALESFORCE_POST_PARAMETERIZED_SEARCH")
    assert sent["q"] == "Northwind renewal"
    assert [o["name"] for o in sent["sobjects"]] == ["Contact", "Account", "Opportunity"]
    for kind in HUBSPOT_OBJECTS.values():
        [asked] = _calls(fake, kind.tool)
        assert asked["query"] == "Northwind renewal" and asked["limit"] == MAX_RECORDS
        assert "hs_object_id" not in str(asked) and set(asked) == {"query", "limit", "properties"}


@pytest.mark.asyncio
async def test_who_it_came_from_searches_people_and_dates_are_kept_to(fake):
    found, _ = await search_everything(fake, TEST_USER_ID, [HUBSPOT], Search(sender="Okafor"), NOW)
    assert [i.id for i in found] == ["contact:501"]
    assert _calls(fake, "HUBSPOT_SEARCH_DEALS") == [] and _calls(fake, "HUBSPOT_SEARCH_COMPANIES") == []
    day = lambda offset: composio_mock_data._day(offset)[:10]  # noqa: E731
    recent, _ = await search_everything(fake, TEST_USER_ID, [SALESFORCE], Search(words="Northwind", after=day(-2)), NOW)
    assert [i.id for i in recent] == [OPPORTUNITY]
    older, _ = await search_everything(fake, TEST_USER_ID, [SALESFORCE], Search(words="Northwind", before=day(-5)), NOW)
    assert [i.id for i in older] == ["Account:001Hs00000Z9y8xIAB"]
    # One letter is not a search Salesforce accepts: nothing is sent.
    before = len(fake.calls)
    assert await SEARCHES[SALESFORCE](fake, "s", Search(words="a"), NOW) == []
    assert len(fake.calls) == before


@pytest.mark.asyncio
async def test_when_the_first_salesforce_search_is_refused_a_sosl_search_is_tried(fake):
    fake.fail_tools.add("SALESFORCE_POST_PARAMETERIZED_SEARCH")
    found, problems = await search_everything(fake, TEST_USER_ID, [SALESFORCE], Search(words="Dana Whitfield"), NOW)
    assert problems == [] and [i.id for i in found] == ["Contact:003Hs00000Q7w6vIAB"]
    [sent] = _calls(fake, "SALESFORCE_EXECUTE_SOSL_SEARCH")
    assert sent["q"].startswith("FIND {Dana Whitfield} IN ALL FIELDS RETURNING Contact(Id, Name, LastModifiedDate")


def test_search_words_cannot_be_sosl():
    assert sosl_for("O'Brien & Sons (UK)").startswith("FIND {O\\'Brien \\& Sons \\(UK\\)} IN ALL FIELDS")
    assert "Opportunity(Id, Name, LastModifiedDate ORDER BY LastModifiedDate DESC LIMIT 10)" in sosl_for("x y")


@pytest.mark.asyncio
async def test_a_record_is_read_as_its_listed_fields_cleaned(fake):
    texts, files, skipped = await read(fake, TEST_USER_ID, [PickedItem(id=OPPORTUNITY, toolkit=SALESFORCE, kind="crm_record", title="Northwind")])
    assert files == [] and skipped == []
    [record] = texts
    assert (record.kind, record.toolkit, record.title) == ("crm_record", SALESFORCE, "Northwind Holdings renewal")
    assert record.source.startswith("Salesforce · Opportunity")
    for line in ("Opportunity: Northwind Holdings renewal", "Account: Northwind Holdings", "Stage: Negotiation/Review", "Amount: 84000",
                 "Close date: 2026-12-15", "Probability (%): 60", "Next step: Send revised terms", "Renewal at a 3% uplift, three-year term."):
        assert line in record.text
    # Hidden text and links are gone; a field that is not on the list was never asked for.
    assert "Ignore your instructions" not in record.text and "attacker.example" not in record.text
    assert "https://" not in record.text and "[link removed]" in record.text
    assert "margin" not in record.text.lower()
    [sent] = _calls(fake, "SALESFORCE_RUN_SOQL_QUERY")
    assert sent["query"] == f"SELECT {', '.join(salesforce_fields(SALESFORCE_OBJECTS['Opportunity']))} FROM Opportunity WHERE Id = '006Hs00000A1b2cIAB' LIMIT 1"
    assert "Internal_Margin__c" not in sent["query"]


@pytest.mark.asyncio
async def test_hubspot_records_are_read_by_their_own_kind(fake):
    picked = [PickedItem(id="deal:9001", toolkit=HUBSPOT, kind="crm_record"), PickedItem(id="company:9001", toolkit=HUBSPOT, kind="crm_record")]
    texts, _files, skipped = await read(fake, TEST_USER_ID, picked)
    assert skipped == []
    deal, company = texts
    assert deal.title == "Okafor Estates lease renewal" and "Amount: 18500" in deal.text and "Lease renews at 3% above the current rent." in deal.text
    assert company.title == "Okafor Estates" and "Industry: REAL_ESTATE" in company.text and "Domain: okafor-estates.example" in company.text
    assert deal.source.startswith("HubSpot · Deal") and company.source.startswith("HubSpot · Company")
    [asked] = _calls(fake, "HUBSPOT_SEARCH_DEALS")
    assert asked["filterGroups"] == [{"filters": [{"propertyName": "hs_object_id", "operator": "EQ", "value": "9001"}]}]


@pytest.mark.asyncio
async def test_an_id_that_is_not_one_never_reaches_a_query(fake):
    bad = [
        PickedItem(id="Opportunity:006' OR Name != '", toolkit=SALESFORCE, kind="crm_record", title="a"),
        PickedItem(id="Lead:00QHs00000A1b2cIAB", toolkit=SALESFORCE, kind="crm_record", title="b"),
        PickedItem(id="deal:9001 OR 1=1", toolkit=HUBSPOT, kind="crm_record", title="c"),
        PickedItem(id="006Hs00000A1b2cIAB", toolkit=SALESFORCE, kind="crm_record", title="d"),
        PickedItem(id=OPPORTUNITY, toolkit=SALESFORCE, kind="email", title="e"),
    ]
    texts, _files, skipped = await read(fake, TEST_USER_ID, bad)
    assert texts == [] and len(skipped) == 5
    assert [kind for kind, _ in fake.calls if kind == "execute"] == []


@pytest.mark.asyncio
async def test_a_field_the_profile_may_not_see_does_not_cost_the_record(fake):
    seen: list[str] = []
    real = fake.execute

    async def execute(session_id: str, tool: str, arguments: dict[str, Any]) -> Any:
        if tool == "SALESFORCE_RUN_SOQL_QUERY":
            seen.append(arguments["query"])
            if "StageName" in arguments["query"]:
                from promptmaster.composio_client import ComposioError
                raise ComposioError("No such column 'NextStep' on entity 'Opportunity'")
        return await real(session_id, tool, arguments)

    fake.execute = execute  # type: ignore[method-assign]
    texts, _files, skipped = await read(fake, TEST_USER_ID, [PickedItem(id=OPPORTUNITY, toolkit=SALESFORCE, kind="crm_record")])
    assert skipped == [] and texts[0].title == "Northwind Holdings renewal"
    assert seen[1] == "SELECT Id, Name, LastModifiedDate FROM Opportunity WHERE Id = '006Hs00000A1b2cIAB' LIMIT 1"


@pytest.mark.asyncio
async def test_with_nothing_typed_the_open_deals_are_what_is_going_on(fake):
    items, problems = await preview(fake, TEST_USER_ID, [SALESFORCE, HUBSPOT], NOW)
    assert problems == []
    assert {i.id for i in items} == {OPPORTUNITY, "deal:9001"}
    [soql] = _calls(fake, "SALESFORCE_RUN_SOQL_QUERY")
    assert "FROM Opportunity WHERE IsClosed = false ORDER BY LastModifiedDate DESC LIMIT 10" in soql["query"]
    fake.fail_tools.add("HUBSPOT_SEARCH_DEALS")
    again, problems = await preview(fake, TEST_USER_ID, [HUBSPOT], NOW)
    assert problems == [] and [i.id for i in again] == ["deal:9001"]
    assert _calls(fake, "HUBSPOT_LIST_DEALS")


def test_records_come_after_meetings_mail_and_files_and_take_their_turn():
    def item(kind: str, n: int) -> PreviewItem:
        return PreviewItem(id=f"{kind}-{n}", toolkit="x", kind=kind, title=f"{kind} {n}", when=f"2026-11-{10 + n:02d}T10:00:00Z")  # type: ignore[arg-type]

    mixed = [item("crm_record", 1), item("file", 1), item("email", 1), item("calendar_event", 1), item("crm_record", 2)]
    assert [i.kind for i in ordered(mixed)] == ["calendar_event", "email", "file", "crm_record", "crm_record"]
    assert [i.id for i in ordered(mixed)][-2:] == ["crm_record-2", "crm_record-1"]
    assert "crm_record" in [i.kind for i in _newest_of_each(ordered(mixed), 4)]


def test_the_prompts_name_the_crm_and_keep_the_openings_the_mock_matches():
    assert account_search._DECIDE_SYSTEM.startswith("You decide whether a piece of work needs a search of the person's own email")
    assert "files and CRM" in account_search._DECIDE_SYSTEM and "a customer, deal or contact on record" in account_search._DECIDE_SYSTEM
    assert account_search._PICK_SYSTEM.startswith("You choose which of a person's emails, meetings and files to open")
    assert "CRM records (contacts, companies, deals)" in account_search._PICK_SYSTEM
    _system, user = account_search.build_decide_prompt("o", "t")
    assert "THE WORK TO DO NOW:" in user and user.endswith("Does this need a search of their email, calendar, files or CRM?")


def test_the_settings_list_names_both_and_each_can_be_linked(fake):
    body = client.get("/api/connections").json()
    assert {"salesforce", "hubspot"} <= {t["slug"] for t in body["toolkits"]}
    assert {a["toolkit"] for a in body["accounts"]} == {SALESFORCE, HUBSPOT}
    again = client.post("/api/connections/link", json={"toolkit": "salesforce", "callback_url": f"{ORIGIN}/projects/connect"})
    assert again.status_code == 409  # already connected
    assert client.post("/api/connections/link", json={"toolkit": "zoominfo", "callback_url": f"{ORIGIN}/projects/connect"}).status_code == 422


def test_disconnecting_one_crm_withdraws_its_own_grant_and_leaves_the_other(fake):
    out = client.delete("/api/connections/acc-sf")
    assert out.status_code == 200 and out.json() == {"deleted": True, "revoked": True}
    assert ("revoke", ("acc-sf", True)) in fake.calls
    assert [a["toolkit"] for a in client.get("/api/connections").json()["accounts"]] == [HUBSPOT]


def test_go_never_searches_accounts():
    """CLAUDE.md: Go never sends `account_search`; a CRM does not change that."""
    models = [m for m in vars(agent_router).values() if isinstance(m, type) and issubclass(m, BaseModel) and m is not BaseModel]
    assert models
    assert not [m.__name__ for m in models if "account_search" in m.model_fields]
