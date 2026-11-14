"""Meetings from calendar/<Sunday>.json and calendar/used.json: the same rules as the panel
(extension/src/core/meetings.ts)."""
import json
import time

import pytest

import timelog
import timelog_store as s


@pytest.fixture(autouse=True)
def prague(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Prague")  # UTC+1 in November
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def ev(id, start, end, title="M", **more):
    return {"id": id, "start": start, "end": end, "all_day": False, "title": title, "description": "",
            "attendees": ["a@x.test", "b@x.test"], "my_status": "YES", "recurring": False, **more}


EVENTS = [
    ev("m45", "2026-11-17T08:00:00.000Z", "2026-11-17T08:45:00.000Z", "Workshop"),
    ev("m20", "2026-11-17T09:00:00.000Z", "2026-11-17T09:20:00.000Z", "Standup"),
    ev("no", "2026-11-17T10:00:00.000Z", "2026-11-17T11:00:00.000Z", "Declined", my_status="NO"),
    ev("day", "2026-11-16T23:00:00.000Z", "2026-11-17T23:00:00.000Z", "Home office", all_day=True),
    {"id": "h", "date": "2026-11-17", "holiday": True, "title": "Holiday", "description": "Public holiday",
     "start": "2026-11-16T23:00:00.000Z", "end": "2026-11-17T23:00:00.000Z", "all_day": True},
    ev("r1", "2026-11-17T12:00:00.000Z", "2026-11-17T13:00:00.000Z", "Weekly", recurring=True),
    ev("r1", "2026-11-18T12:00:00.000Z", "2026-11-18T13:00:00.000Z", "Weekly", recurring=True),
    ev("late", "2026-11-17T22:30:00.000Z", "2026-11-17T23:30:00.000Z", "Late call"),
]


@pytest.fixture
def calendar(timelog_home):
    (timelog_home / "calendar").mkdir(parents=True)
    (timelog_home / "calendar" / "2026-11-15.json").write_text(json.dumps({"events": EVENTS}), encoding="utf-8")


def run(capsys, *argv):
    code = timelog.main(list(argv))
    out, err = capsys.readouterr()
    return code, out, err


def meetings(capsys, day):
    code, out, err = run(capsys, "meetings", "--date", day)
    assert code == 0, err
    return {m["id"]: m for m in json.loads(out)}


def add(capsys, day, meeting, hours="1"):
    return run(capsys, "add", "--project", "P", "--task", "T", "--time-type", "Y", "--hours", hours,
               "--description", "d", "--note", "n", "--date", day, "--meeting", meeting)


def test_meetings_lists_only_real_meetings_with_rounded_up_hours(calendar, capsys):
    ms = meetings(capsys, "2026-11-17")
    assert sorted(ms) == ["late", "m20", "m45", "r1"]  # no declined, all-day or holiday entries
    assert (ms["m45"]["hours"], ms["m20"]["hours"]) == (1.0, 0.5)
    assert ms["m45"]["attendees"] == 2 and ms["m45"]["used"] is None


def test_late_meeting_belongs_to_its_start_day(calendar, capsys):
    assert meetings(capsys, "2026-11-17")["late"]["date"] == "2026-11-17"
    assert "late" not in meetings(capsys, "2026-11-18")


def test_add_with_meeting_records_it_and_meetings_shows_it_used(calendar, capsys):
    assert add(capsys, "2026-11-17", "m45")[0] == 0
    line = {"project": "P", "task": "T", "time_type": "Y"}
    assert s.read_used()["m45|2026-11-17"] == line
    assert meetings(capsys, "2026-11-17")["m45"]["used"] == line


def test_recurring_meeting_used_on_one_day_only(calendar, capsys):
    assert add(capsys, "2026-11-17", "r1")[0] == 0
    assert meetings(capsys, "2026-11-17")["r1"]["used"] is not None
    assert meetings(capsys, "2026-11-18")["r1"]["used"] is None


def test_meeting_is_free_again_when_its_cell_has_no_hours(calendar, capsys):
    add(capsys, "2026-11-17", "m45")
    eid = s.read_entries()[0].id
    assert run(capsys, "delete", eid)[0] == 0
    assert meetings(capsys, "2026-11-17")["m45"]["used"] is None
    assert "m45|2026-11-17" in s.read_used()  # records are never cleaned up


def test_add_with_unknown_meeting_fails(calendar, capsys):
    code, _, err = add(capsys, "2026-11-17", "r9")
    assert code == 2 and "no meeting r9 on 2026-11-17" in err
    assert s.read_entries() == [] and s.read_used() == {}


def test_week_lists_the_whole_week(calendar, capsys):
    code, out, _ = run(capsys, "meetings", "--week", "2026-11-18")
    assert code == 0
    assert [(m["id"], m["date"]) for m in json.loads(out)].count(("r1", "2026-11-18")) == 1
