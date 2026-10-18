"""The current reporting date is worked out in code (18 Oct, L-89): a repair put a
status pack's Status back on the brief's November 2 figures although an accepted
fact gave November 5."""

from datetime import date

from promptmaster.project_context import as_of_dates, context_block, reporting_date_line
from promptmaster.schemas import AcceptedFact, PMInput

BRIEF = (
    "A short status pack for fictional Project REEF. Baseline as of November 2, 2026: launch "
    "November 20, approved budget $40,000, spending to date $15,000."
)


def _inputs(*facts: str) -> PMInput:
    return PMInput(objective=BRIEF, mode="architect", facts=[AcceptedFact(statement=s) for s in facts])


def test_dates_are_read_in_the_usual_forms():
    assert as_of_dates("as of November 5, 2026; as of 2 Nov; as at 2026-11-07") == [
        date(2026, 11, 5), date(2026, 11, 2), date(2026, 11, 7),
    ]
    assert as_of_dates("as of Nov 5") == []  # no year anywhere: not guessed


def test_a_later_dated_fact_makes_its_date_current_and_the_brief_the_baseline():
    inputs = _inputs("As of November 5, 2026, spending to date is $16,000.")
    line = reporting_date_line(inputs)
    assert "as of November 5, 2026" in line
    assert "brief's November 2, 2026 baseline" in line
    assert "never back in the current position" in line
    assert line in context_block(inputs)


def test_no_line_when_no_fact_is_later_than_the_brief():
    assert reporting_date_line(_inputs("Only Elena may approve changes to the launch date or budget.")) == ""
    assert reporting_date_line(_inputs("As of November 2, 2026, spending to date is $15,000.")) == ""
    assert reporting_date_line(PMInput(objective="A status pack.", mode="architect", facts=[
        AcceptedFact(statement="As of November 5, 2026, spending to date is $16,000."),
    ])) == ""
