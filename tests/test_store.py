from datetime import date

import pytest

import timelog_store as s


def entry(**kw):
    base = dict(
        id="e1",
        date="2026-10-12",
        project="Acme : Impl",
        task="Build",
        time_type="Billable",
        hours=2.0,
        description="d",
        note="n",
    )
    base.update(kw)
    return s.Entry(**base)


def test_entries_round_trip_special_chars(timelog_home):
    e = entry(description='a, "b"\nc', note="čeština — ok")
    s.write_entries([e])
    assert s.read_entries() == [e]
    first_line = (timelog_home / "entries.csv").read_text(encoding="utf-8").splitlines()[0]
    assert first_line == "id,date,project,task,time_type,hours,description,note"


def test_week_range_sunday_to_saturday():
    assert s.week_range(date(2026, 10, 14)) == (date(2026, 10, 11), date(2026, 10, 17))
    assert s.week_range(date(2026, 10, 11)) == (date(2026, 10, 11), date(2026, 10, 17))
    assert s.week_range(date(2026, 10, 17)) == (date(2026, 10, 11), date(2026, 10, 17))


def test_parse_date():
    today = date(2026, 11, 11)
    assert s.parse_date("today", today) == today
    assert s.parse_date("yesterday", today) == date(2026, 11, 10)
    assert s.parse_date("2026-10-12", today) == date(2026, 10, 12)
    with pytest.raises(ValueError):
        s.parse_date("monday", today)


def test_validate_entry():
    with pytest.raises(ValueError) as err:
        s.validate_entry(entry(note=""))
    assert str(err.value) == "description and note are required (SPP rejects the save otherwise)"
    for bad in [entry(hours=0), entry(hours=25), entry(task="")]:
        with pytest.raises(ValueError):
            s.validate_entry(bad)
    s.validate_entry(entry())
